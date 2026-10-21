#!/usr/bin/env bun
// Fails when a patch's replacement uses a minified name its anchor doesn't
// contain. Such a patch only applies while upstream keeps that name, so the
// next release's renames break it instead of porting it (scripts/patch.ts).
// Lengthen the anchor until it contains every name the replacement uses.

import { resolve } from "node:path";
import { identifiers, type Patch } from "./patch";

const patches: Patch[] = await Bun.file(
	resolve(import.meta.dir, "../patches.json"),
).json();
let bad = 0;
patches.forEach((p, i) => {
	const pinned = new Set(
		identifiers(p.find)
			.filter((t) => t.mangled)
			.map((t) => t.name),
	);
	const loose = new Set(
		identifiers(p.replace ?? "")
			.filter((t) => t.mangled && !pinned.has(t.name))
			.map((t) => t.name),
	);
	if (!loose.size) return;
	bad++;
	console.error(
		`patches.json #${i} [${p.group}]: replacement uses ${[...loose].join(", ")}, which the anchor doesn't contain`,
	);
});
if (bad) process.exit(1);
