#!/usr/bin/env bun
// Converts the BetterCampus Chrome Web Store zip into a stripped-down Firefox MV3 build.
// Usage: bun port-to-firefox.ts [--update-patches] [path/to/chrome.zip]
//
// --update-patches writes anchors that only matched under renamed identifiers
// back to patches.json and, when the whole port succeeds, records the zip's
// version in upstream.json.

import { existsSync, readdirSync, rmSync } from "node:fs";
import { basename, resolve } from "node:path";
import { parse } from "acorn";
import { $ } from "bun";
import { type MinifyOptions, minify } from "terser";
import { applyPatch, describe, type Patch } from "./scripts/patch";

const root = import.meta.dir;
const args = process.argv.slice(2);
const updatePatches = args.includes("--update-patches");
const zip = resolve(
	args.find((a) => !a.startsWith("--")) ??
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

const manifestPath = resolve(outDir, "manifest.json");
const manifest = await Bun.file(manifestPath).json();
const upstreamPath = resolve(root, "upstream.json");
const upstream = await Bun.file(upstreamPath).json();
console.log(
	`Porting ${basename(zip)} (v${manifest.version}; patches.json is for v${upstream.version})`,
);

// Everything that needs a human, collected so one run reports all of it.
const problems: string[] = [];

// Upstream surface we've reviewed, listed in upstream.json. A new manifest
// key, permission, content script or network host stops the build, so an
// automatic port can't ship a new bridge to bettercampus.com, a new
// permission or a new analytics service unseen. Review it, then list it there
// (or strip it here).
const reviewed: Record<string, string[]> = upstream.reviewed;
const unreviewed = (kind: string, items: Iterable<string>, list: string[]) => {
	for (const item of new Set(items))
		if (!list.includes(item))
			problems.push(
				`New ${kind} ${item}: review it, then list it in upstream.json`,
			);
};
unreviewed("manifest key", Object.keys(manifest), reviewed.manifest);
unreviewed(
	"permission",
	[...(manifest.permissions ?? []), ...(manifest.host_permissions ?? [])],
	reviewed.permissions,
);

// Strip AI study tools, login/Pro upsells, promos, and cloud app pages. Every
// anchor must match exactly once, so a new upstream version fails loudly
// instead of silently skipping a patch. An anchor that matches only under
// renamed minified identifiers is moved to the new names (scripts/patch.ts).
// An entry without `replace` only pins upstream code that src/ mirrors.
const patches: Patch[] = await Bun.file(resolve(root, "patches.json")).json();
const moved: string[] = [];
for (const [file, list] of Map.groupBy(patches, (p) => p.file)) {
	const path = resolve(outDir, file);
	let src = await Bun.file(path).text();
	for (const patch of list) {
		const i = patches.indexOf(patch);
		const applied = applyPatch(src, patch);
		if (typeof applied === "string") {
			const find =
				patch.find.length > 160 ? `${patch.find.slice(0, 160)}…` : patch.find;
			problems.push(
				`Patch #${i} [${patch.group}] ${file}: ${applied}. Re-derive it.\n    find: ${find}\n    why:  ${patch.why}`,
			);
			continue;
		}
		src = applied.src;
		patches[i] = applied.patch;
		if (applied.renames.size)
			moved.push(`#${i} [${patch.group}] ${describe(applied.renames)}`);
	}
	await Bun.write(path, src);
}
if (moved.length) {
	console.log(`  ${moved.length} anchors matched under renamed identifiers:`);
	for (const line of moved) console.log(`    ${line}`);
	if (updatePatches)
		await Bun.write(
			resolve(root, "patches.json"),
			`${JSON.stringify(patches, null, 2)}\n`,
		);
}

// Content scripts that only serve the removed cloud/Pro features: calendar
// sync, Stripe checkout, the bridge that hands ext.bettercampus.com the
// extension's settings, IndexedDB and Canvas tab, and the one that relays
// app.bettercampus.com's sign-in, sign-out and calendar connection.
const unused = [
	"content-scripts/googlecalendar.js",
	"content-scripts/outlookcalendar.js",
	"content-scripts/stripe.js",
	"content-scripts/extension-bridge.js",
	"content-scripts/app-bridge.js",
];
manifest.content_scripts = manifest.content_scripts.filter(
	(cs: { js: string[] }) => !cs.js.some((js) => unused.includes(js)),
);
for (const f of unused) rmSync(resolve(outDir, f), { force: true });
unreviewed(
	"content script",
	manifest.content_scripts.flatMap((cs: { js?: string[]; css?: string[] }) => [
		...(cs.js ?? []),
		...(cs.css ?? []),
	]),
	reviewed.contentScripts,
);

// Hosts the shipped files name. Most are links and docs; a new one can be a
// new backend or analytics endpoint.
const hosts = new Set<string>();
for (const file of new Bun.Glob("**/*.{js,css,html,json}").scanSync(outDir))
	for (const [, host] of (
		await Bun.file(resolve(outDir, file)).text()
	).matchAll(/\b(?:https?|wss?):\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)+)/gi))
		hosts.add(host.toLowerCase());
unreviewed("host", [...hosts].sort(), reviewed.hosts);

if (problems.length) {
	console.error(
		`\nv${manifest.version} needs ${problems.length} fixes before it can ship:\n\n${problems.map((p) => `- ${p}`).join("\n")}`,
	);
	process.exit(1);
}
if (updatePatches && upstream.version !== manifest.version) {
	upstream.version = manifest.version;
	await Bun.write(upstreamPath, `${JSON.stringify(upstream, null, 2)}\n`);
}

// Packaged files nothing references (5.9 MB): large illustrations, the
// referral avatars, the grades onboarding videos, a Chrome Web Store
// screenshot, old and unused icons, and a dark-mode stylesheet the bundle
// doesn't load (it builds its own). Each pattern must match, and no remaining
// file may name what it removed, so a new upstream version that starts using
// one fails here.
const deadAssets = [
	"navigator/navigator_*.png",
	"navigator/themes_*.png",
	"referrals/**",
	"first-time/**",
	"cws.webp",
	"assets/dark.css",
	"icon/icon-19.png",
	"icon/icon-38.png",
	"icon/iconwpadding.png",
	"icon/oldicon-128.png",
];
const dead = deadAssets.flatMap((pattern) => {
	const hits = [...new Bun.Glob(pattern).scanSync(outDir)];
	if (!hits.length) throw new Error(`Dead asset ${pattern} matched nothing`);
	return hits;
});
for (const f of dead) rmSync(resolve(outDir, f));
for (const dir of ["referrals", "first-time"])
	rmSync(resolve(outDir, dir), { recursive: true });
for (const file of new Bun.Glob("**/*.{js,css,json,html}").scanSync(outDir)) {
	const text = await Bun.file(resolve(outDir, file)).text();
	const named = dead.find((f) => text.includes(basename(f)));
	if (named) throw new Error(`${file} still refers to removed ${named}`);
}

// Web-accessible patterns left matching nothing.
manifest.web_accessible_resources = manifest.web_accessible_resources
	.map((war: { resources: string[] }) => ({
		...war,
		resources: war.resources.filter(
			(p) => !new Bun.Glob(p).scanSync(outDir).next().done,
		),
	}))
	.filter((war: { resources: string[] }) => war.resources.length);

// BetterCampus wraps ~9k functions per bundle in a local profiler:
//   const e=at("id");try{BODY}catch(n){throw ot(e),n}finally{st(e)}
// Its spans only record while a hidden debug mode is on (a Debug tab that
// times BetterCampus for its developers). Otherwise every call pays for the
// span lookup and a try/catch/finally that do nothing. Each wrapper becomes
// `const e=/*@__PURE__*/at("id");{BODY}`, and the minifier below drops the
// declaration wherever nothing reads `e`. Some bodies keep it for their
// `it(e, promise)` calls, which hand the promise back untouched while
// recording is off.

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

	// [from, to, text]: replace src[from, to) with text.
	const edits: [number, number, string][] = [];
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
			const start = list[i].declarations[0].init.start;
			edits.push(
				[start, start, "/*@__PURE__*/"],
				[t.start, t.block.start, ""],
				[t.block.end, t.end, ""],
			);
		}
		for (const value of Object.values(n))
			if (value && typeof value === "object") stack.push(value);
	}
	if (profilers.size > 1)
		throw new Error(`${file}: expected one profiler, found ${[...profilers]}`);
	if (!profilers.size) return src;

	edits.sort((a, b) => a[0] - b[0]);
	let out = "";
	let pos = 0;
	for (const [from, to, text] of edits) {
		out += src.slice(pos, from) + text;
		pos = to;
	}
	out += src.slice(pos);
	console.log(
		`  ${file}: unwrapped ${edits.length / 3} profiler spans (${[...profilers][0]})`,
	);
	return out;
}

// Dead-code pass over every bundle. It removes the unused span ids above,
// code the patches leave unreachable (after an early `return;`, behind
// `!1&&`), and whatever only that code used, like the campaign card's 842 KB
// inline image. Only passes that delete or fold code run: no mangling (the
// bundles already are), no inlining and no merging of variables.
const MINIFY: MinifyOptions = {
	compress: {
		defaults: false,
		booleans: true,
		conditionals: true,
		dead_code: true,
		evaluate: true,
		if_return: true,
		reduce_vars: true,
		side_effects: true,
		unused: true,
		keep_classnames: true,
		keep_fnames: true,
	},
	mangle: false,
};

// AMO's linter refuses to parse (and so refuses to sign) any JS file of 5 MiB
// or more.
const MAX_JS_BYTES = 5 * 1024 * 1024;
const kib = (n: number) => `${(n / 1024).toFixed(0)} KiB`;

for (const file of new Bun.Glob("**/*.js").scanSync(outDir)) {
	const path = resolve(outDir, file);
	const src = await Bun.file(path).text();
	const { code } = await minify(stripProfiler(src, file), MINIFY);
	if (!code) throw new Error(`${file}: minifier returned nothing`);
	parse(code, { ecmaVersion: "latest", sourceType: "script" });
	const size = Buffer.byteLength(code);
	if (size >= MAX_JS_BYTES)
		throw new Error(`${file} is over AMO's 5 MiB parse limit`);
	await Bun.write(path, code);
	console.log(`  ${file}: ${kib(Buffer.byteLength(src))} → ${kib(size)}`);
}

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

// Our own scripts (src/): two content scripts, in the same isolated world as
// all.js, and the options page's settings export/import.
for (const [entry, file] of [
	["src/bcx/main.ts", "content-scripts/bcx.js"],
	["src/subframe.ts", "content-scripts/subframe.js"],
	["src/options/options.ts", "options/options.js"],
]) {
	const out = await Bun.build({
		entrypoints: [resolve(root, entry)],
		target: "browser",
		format: "iife",
		minify: true,
	});
	if (!out.success) throw new AggregateError(out.logs, `${entry} build failed`);
	await Bun.write(resolve(outDir, file), out.outputs[0]);
}
await Bun.write(
	resolve(outDir, "options/options.html"),
	Bun.file(resolve(root, "src/options/options.html")),
);
manifest.options_ui = { page: "options/options.html", open_in_tab: true };

// all.js runs in the top frame only, followed by bcx.js, whose functions its
// patched controls call through globalThis.__bcx. In subframes, all.js used
// to initialize all of BetterCampus only to add a font and an anti-flicker
// style; subframe.js does just that there (see src/subframe.ts).
const allIndex = manifest.content_scripts.findIndex((cs: { js: string[] }) =>
	cs.js.includes("content-scripts/all.js"),
);
const allEntry = manifest.content_scripts[allIndex];
delete allEntry.all_frames;
allEntry.js.push("content-scripts/bcx.js");
manifest.content_scripts.splice(allIndex + 1, 0, {
	matches: allEntry.matches,
	exclude_matches: allEntry.exclude_matches,
	all_frames: true,
	run_at: allEntry.run_at,
	js: ["content-scripts/subframe.js"],
});

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
await $`cd ${outDir} && zip -qr -X -9 ${xpi} .`;

console.log(
	`Ported ${basename(zip)} (v${manifest.version}), ${patches.filter((p) => p.replace !== undefined).length} patches`,
);
console.log(`  unpacked: ${outDir}`);
console.log(`  xpi:      ${xpi} (${kib(Bun.file(xpi).size)})`);
