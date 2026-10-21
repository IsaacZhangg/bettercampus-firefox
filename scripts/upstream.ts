#!/usr/bin/env bun
// Asks the Chrome Web Store for BetterCampus's latest version and, with
// --download, saves its package as a zip that port-to-firefox.ts takes.
// Usage: bun scripts/upstream.ts [--download [dir]]
// Prints JSON: {version, ported, new, zip?}. `ported` is the version
// patches.json is for (upstream.json); `new` says the store has a later one.

import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const { id, version: ported } = await Bun.file(
	resolve(root, "upstream.json"),
).json();

// The update check Chrome itself makes. prodversion is the asking Chrome's
// version, which has to meet the extension's minimum_chrome_version.
const check = new URL("https://clients2.google.com/service/update2/crx");
check.search = new URLSearchParams({
	response: "updatecheck",
	prodversion: "150.0",
	acceptformat: "crx3",
	x: `id=${id}&uc`,
}).toString();
const res = await fetch(check);
if (!res.ok) throw new Error(`Update check failed: HTTP ${res.status}`);
const xml = await res.text();
const tag = xml.match(/<updatecheck\b[^>]*>/)?.[0] ?? "";
const attr = (name: string) =>
	tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1]?.replaceAll("&amp;", "&");
const version = attr("version");
const codebase = attr("codebase");
if (attr("status") !== "ok" || !version || !codebase)
	throw new Error(`Unexpected update check response: ${xml}`);

const parts = (v: string) => v.split(".").map(Number);
const newer = (a: string, b: string) => {
	const [x, y] = [parts(a), parts(b)];
	for (let i = 0; i < Math.max(x.length, y.length); i++)
		if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
	return false;
};
const out: Record<string, unknown> = {
	version,
	ported,
	new: newer(version, ported),
};

const flag = process.argv.indexOf("--download");
if (flag >= 0) {
	const dir = resolve(process.argv[flag + 1] ?? root);
	const crx = new Uint8Array(await (await fetch(codebase)).arrayBuffer());
	const sha256 = new Bun.CryptoHasher("sha256").update(crx).digest("hex");
	if (sha256 !== attr("hash_sha256") || String(crx.length) !== attr("size"))
		throw new Error(`Download doesn't match the update check: ${codebase}`);

	// A CRX is a zip behind a header: "Cr24", a format version, then (CRX3) the
	// header's length or (CRX2) the public key's and signature's lengths.
	const view = new DataView(crx.buffer);
	const u32 = (at: number) => view.getUint32(at, true);
	if (new TextDecoder().decode(crx.subarray(0, 4)) !== "Cr24")
		throw new Error("Not a CRX file");
	const start =
		u32(4) === 3
			? 12 + u32(8)
			: u32(4) === 2
				? 16 + u32(8) + u32(12)
				: Number.NaN;
	if (u32(start) !== 0x04034b50)
		throw new Error(`Unsupported CRX format version ${u32(4)}`);
	const zip = resolve(dir, `BetterCampus-${version}-Chrome.zip`);
	await Bun.write(zip, crx.subarray(start));
	out.zip = zip;
}
console.log(JSON.stringify(out));
