#!/usr/bin/env bun
// Builds the pushed HEAD and publishes it as a GitHub release with the
// unsigned .xpi attached. The "Sign release" workflow then signs it with AMO
// and swaps in the signed .xpi.
// Usage: bun run release [path/to/chrome.zip]
// BUILD=n sets the fourth version part. By default it's one past the highest
// v<upstream>.n release, or none if this upstream version has no release yet.

import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { $ } from "bun";

const root = import.meta.dir;
$.cwd(root);

// The release tags HEAD on GitHub, so the build must come from exactly that
// commit.
if ((await $`git status --porcelain`.text()).trim())
	throw new Error("Commit or stash your changes first");
await $`git fetch --quiet --tags origin`;
const head = (await $`git rev-parse HEAD`.text()).trim();
if (head !== (await $`git rev-parse ${"@{u}"}`.text()).trim())
	throw new Error("HEAD doesn't match its upstream branch; push or pull first");

const zip = resolve(
	process.argv[2] ??
		readdirSync(root).find((f) => f.endsWith(".zip") && f.includes("Chrome")) ??
		"",
);
const { version: base } = JSON.parse(
	await $`unzip -p ${zip} manifest.json`.text(),
);

const tags = (await $`git tag --list ${`v${base}*`}`.text()).split("\n");
const builds = tags.flatMap((tag) => {
	const m = tag.slice(`v${base}`.length).match(/^(?:\.(\d+))?$/);
	return tag && m ? [Number(m[1] ?? 0)] : [];
});
const build =
	process.env.BUILD ||
	(builds.length ? String(Math.max(...builds) + 1) : undefined);
const version = build ? `${base}.${build}` : base;
const tag = `v${version}`;
if (tags.includes(tag)) throw new Error(`${tag} is already released`);

await $`bun port-to-firefox.ts ${zip}`.env({
	...process.env,
	BUILD: build ?? "",
});
await $`bun run lint:ext`;

const [prev] = (await $`git tag --list ${"v*"} --sort=-v:refname`.text())
	.split("\n")
	.filter(Boolean);
const changes = prev
	? await $`git log --format=${"- %s"} ${`${prev}..HEAD`}`.text()
	: "";
const notes = `The signed \`.xpi\` is attached a few minutes after release. Install it from \`about:addons\` → ⚙ → **Install Add-on From File…**.${changes && `\n\n## Changes\n\n${changes}`}`;

const xpi = resolve(root, "dist", `bettercampus-firefox-${version}.xpi`);
await $`gh release create ${tag} ${xpi} --target ${head} --title ${tag} --notes ${notes}`;
console.log(`Released ${tag}; follow the signing with: gh run watch`);
