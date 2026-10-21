#!/usr/bin/env bun
// Flags patches that a future upstream release could break without anyone
// noticing (scripts/patch.ts explains the matching):
//
// - A replacement that uses a minified name its anchor doesn't contain. Such
//   a patch only applies while upstream keeps that name, so the next
//   release's renames break it instead of porting it. Lengthen the anchor
//   until it contains every name the replacement uses, and give our own locals
//   `$bcx…` names.
// - An anchor with nothing in it but span ids, minified names and keywords,
//   like `const t=at("9popk2gd");try{`. Span ids aren't stable: when upstream
//   reworks a component its ids move to neighboring code (9.9.1 moved
//   "24k25r66" from the remix upgrade button to "Back to themes"), and such an
//   anchor would follow them there. Include a string or a property name from
//   the code itself.

import { resolve } from "node:path";
import { identifiers, type Patch } from "./patch";

const KEYWORDS = new Set(
	"async await break case catch class const continue default delete do else extends false finally for function if in instanceof let new null of return static super switch this throw true try typeof undefined var void while yield".split(
		" ",
	),
);
// Too common in the bundles' JSX to tell code apart.
const GENERIC = new Set(["jsx", "jsxs", "children", "Fragment"]);

const patches: Patch[] = await Bun.file(
	resolve(import.meta.dir, "../patches.json"),
).json();
let bad = 0;
const flag = (i: number, p: Patch, problem: string) => {
	bad++;
	console.error(`patches.json #${i} [${p.group}]: ${problem}`);
};
patches.forEach((p, i) => {
	const ids = identifiers(p.find);
	const pinned = new Set(ids.filter((t) => t.mangled).map((t) => t.name));
	const loose = new Set(
		identifiers(p.replace ?? "")
			.filter((t) => t.mangled && !pinned.has(t.name))
			.map((t) => t.name),
	);
	if (loose.size)
		flag(
			i,
			p,
			`replacement uses ${[...loose].join(", ")}, which the anchor doesn't contain`,
		);

	const strings = [...p.find.matchAll(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g)]
		.map((m) => m[0].slice(1, -1))
		.filter((s) => s && !/^[a-z0-9]{8}$/.test(s));
	const words = ids.filter(
		(t) => !t.mangled && !KEYWORDS.has(t.name) && !GENERIC.has(t.name),
	);
	if (!strings.length && !words.length)
		flag(
			i,
			p,
			"anchor has nothing but span ids, minified names and keywords to recognize its code by",
		);
});
if (bad) process.exit(1);
