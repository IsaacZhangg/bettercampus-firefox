#!/usr/bin/env bun
// Converts the BetterCampus Chrome Web Store zip into a stripped-down Firefox MV3 build.
// Usage: bun port-to-firefox.ts [path/to/chrome.zip]

import { existsSync, readdirSync, rmSync } from "node:fs";
import { basename, resolve } from "node:path";
import { parse } from "acorn";
import { $ } from "bun";

const root = import.meta.dir;
const zip = resolve(
	process.argv[2] ??
		readdirSync(root).find((f) => f.endsWith(".zip") && f.includes("Chrome")) ??
		"",
);
if (!existsSync(zip)) throw new Error(`Chrome zip not found: ${zip}`);

const outDir = resolve(root, "firefox");
const distDir = resolve(root, "dist");

rmSync(outDir, { recursive: true, force: true });
await $`unzip -q ${zip} -d ${outDir}`;

// Chrome Web Store signature data; meaningless (and flagged by the AMO linter) in Firefox.
rmSync(resolve(outDir, "_metadata"), { recursive: true, force: true });

// Strip AI study tools, login/Pro upsells, promos, and cloud app pages. Every
// anchor must match exactly once, so a new upstream version fails loudly
// instead of silently skipping a patch.
type Patch = {
	group: string;
	file: string;
	find: string;
	replace: string;
	why: string;
};
const patches: Patch[] = await Bun.file(resolve(root, "patches.json")).json();
for (const [file, list] of Map.groupBy(patches, (p) => p.file)) {
	const path = resolve(outDir, file);
	let src = await Bun.file(path).text();
	for (const p of list) {
		const hits = src.split(p.find).length - 1;
		if (hits !== 1)
			throw new Error(
				`[${p.group}] ${file}: anchor matched ${hits} times (${p.why})`,
			);
		src = src.replace(p.find, () => p.replace);
	}
	await Bun.write(path, src);
}

// AMO's linter refuses to parse (and so refuses to sign) any JS file of 5 MiB
// or more. BetterCampus wraps ~9k functions in a local profiler:
//   const e=at("id");try{BODY}catch(n){throw ot(e),n}finally{st(e)}
// Its spans only record while a debug flag is on, so in normal use the
// try/catch/finally does nothing. Unwrapping to `const e=at("id");{BODY}`
// gets oversized files under the limit; `e` stays defined for the
// `it(e, promise)` calls some bodies make.
const MAX_JS_BYTES = 5 * 1024 * 1024;

// biome-ignore lint/suspicious/noExplicitAny: ESTree nodes are walked generically.
type AnyNode = { type: string; start: number; end: number; [k: string]: any };

function stripProfiler(src: string, file: string) {
	const ast = parse(src, { ecmaVersion: "latest", sourceType: "script" });
	const ident = (n: AnyNode | undefined, name?: string) =>
		n?.type === "Identifier" && (name === undefined || n.name === name);
	const call = (n: AnyNode | undefined, arg: string) =>
		n?.type === "CallExpression" &&
		ident(n.callee) &&
		n.arguments.length === 1 &&
		ident(n.arguments[0], arg)
			? (n.callee.name as string)
			: undefined;

	// Returns the profiler's start/fail/stop names if `decl; tryStmt` is a wrapper.
	const wrapper = (decl: AnyNode, tryStmt: AnyNode) => {
		if (decl.type !== "VariableDeclaration" || decl.declarations.length !== 1)
			return;
		const { id, init } = decl.declarations[0];
		const arg = init?.arguments?.[0];
		if (
			!ident(id) ||
			init?.type !== "CallExpression" ||
			!ident(init.callee) ||
			init.arguments.length !== 1 ||
			typeof arg?.value !== "string" ||
			!/^[a-z0-9]{8}$/.test(arg.value) ||
			tryStmt.type !== "TryStatement" ||
			!tryStmt.handler ||
			!tryStmt.finalizer
		)
			return;
		const span = id.name as string;
		const param = tryStmt.handler.param;
		const thrown = tryStmt.handler.body.body;
		const finals = tryStmt.finalizer.body;
		const seq = thrown[0]?.argument;
		if (
			!ident(param) ||
			thrown.length !== 1 ||
			thrown[0].type !== "ThrowStatement" ||
			seq?.type !== "SequenceExpression" ||
			seq.expressions.length !== 2 ||
			!ident(seq.expressions[1], param.name) ||
			finals.length !== 1 ||
			finals[0].type !== "ExpressionStatement"
		)
			return;
		const fail = call(seq.expressions[0], span);
		const stop = call(finals[0].expression, span);
		if (fail && stop) return `${init.callee.name}/${fail}/${stop}`;
	};

	const cuts: [number, number][] = [];
	const profilers = new Set<string>();
	const stack: unknown[] = [ast];
	while (stack.length) {
		const node = stack.pop();
		if (Array.isArray(node)) {
			for (const child of node) stack.push(child);
			continue;
		}
		if (!node || typeof node !== "object") continue;
		const n = node as AnyNode;
		const list: AnyNode[] | undefined =
			n.type === "BlockStatement" || n.type === "StaticBlock"
				? n.body
				: n.type === "SwitchCase"
					? n.consequent
					: undefined;
		for (let i = 0; list && i < list.length - 1; i++) {
			const names = wrapper(list[i], list[i + 1]);
			if (!names) continue;
			const t = list[i + 1];
			profilers.add(names);
			cuts.push([t.start, t.block.start], [t.block.end, t.end]);
		}
		for (const value of Object.values(n))
			if (value && typeof value === "object") stack.push(value);
	}
	if (profilers.size !== 1)
		throw new Error(
			`${file}: expected one profiler, found ${[...profilers].join(", ") || "none"}`,
		);

	cuts.sort((a, b) => a[0] - b[0]);
	let out = "";
	let pos = 0;
	for (const [from, to] of cuts) {
		out += src.slice(pos, from);
		pos = to;
	}
	out += src.slice(pos);
	parse(out, { ecmaVersion: "latest", sourceType: "script" });
	console.log(
		`  ${file}: unwrapped ${cuts.length / 2} profiler spans (${[...profilers][0]})`,
	);
	return out;
}

for (const file of new Bun.Glob("**/*.js").scanSync(outDir)) {
	const path = resolve(outDir, file);
	if (Bun.file(path).size < MAX_JS_BYTES) continue;
	const out = stripProfiler(await Bun.file(path).text(), file);
	if (Buffer.byteLength(out) >= MAX_JS_BYTES)
		throw new Error(`${file} is still over AMO's 5 MiB parse limit`);
	await Bun.write(path, out);
}

const manifestPath = resolve(outDir, "manifest.json");
const manifest = await Bun.file(manifestPath).json();

delete manifest.update_url;

// AMO signs each version number once per add-on ID, so re-signing a rebuild of
// the same upstream version needs a fourth part: BUILD=2 → 9.8.15.2.
const build = process.env.BUILD;
if (build) {
	if (!/^[1-9]\d{0,8}$/.test(build))
		throw new Error(`BUILD must be a positive integer, got "${build}"`);
	manifest.version = `${manifest.version}.${build}`;
}

// Firefox has no MV3 service workers; the bundle is a classic script that
// runs fine as a non-persistent event page.
manifest.background = { scripts: [manifest.background.service_worker] };

// Calendar-sync and Stripe checkout helpers only serve the removed cloud/Pro features.
const unused = [
	"content-scripts/googlecalendar.js",
	"content-scripts/outlookcalendar.js",
	"content-scripts/stripe.js",
];
manifest.content_scripts = manifest.content_scripts.filter(
	(cs: { js: string[] }) => !cs.js.some((js) => unused.includes(js)),
);
for (const f of unused) rmSync(resolve(outDir, f));

// Our own versions of the Pro features (src/bcx). Same isolated world as
// all.js, so its patched controls can call globalThis.__bcx.
const bcx = await Bun.build({
	entrypoints: [resolve(root, "src/bcx/main.ts")],
	target: "browser",
	format: "iife",
});
if (!bcx.success) throw new AggregateError(bcx.logs, "src/bcx build failed");
await Bun.write(resolve(outDir, "content-scripts/bcx.js"), bcx.outputs[0]);
manifest.content_scripts
	.find((cs: { js: string[] }) => cs.js.includes("content-scripts/all.js"))
	.js.push("content-scripts/bcx.js");

manifest.browser_specific_settings = {
	gecko: {
		id: "bettercampus-firefox@port",
		// 140 = first ESR with data_collection_permissions; also covers
		// install-time host permissions (127) and storage.session (115).
		strict_min_version: "140.0",
		data_collection_permissions: {
			// Account login and synced Canvas data. No technicalAndInteraction:
			// the telemetry patches stop all PostHog analytics.
			required: [
				"authenticationInfo",
				"personallyIdentifyingInfo",
				"websiteContent",
			],
		},
	},
};

await Bun.write(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

await $`mkdir -p ${distDir}`;
const xpi = resolve(distDir, `bettercampus-firefox-${manifest.version}.xpi`);
rmSync(xpi, { force: true });
await $`cd ${outDir} && zip -qr -X ${xpi} .`;

console.log(
	`Ported ${basename(zip)} (v${manifest.version}), ${patches.length} patches`,
);
console.log(`  unpacked: ${outDir}`);
console.log(`  xpi:      ${xpi}`);
