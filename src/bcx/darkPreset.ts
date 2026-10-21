// BetterCampus themes come with one palette. Applying a light theme also
// makes the palette dark mode uses, but upstream makes it by taking 40% off
// each color's lightness and graying it: a cream page turns mid khaki, its
// text and links near black, and a dark sidebar lighter, under white text.
// Their Tb() now asks `globalThis.__bcxDarkPreset` for that palette instead
// (patches.json, group "fixes"), and keeps its own if we return nothing.
//
// Ours is made in OKLCH, slot by slot. Backgrounds become dark surfaces in
// their own hue, with the light theme's steps inverted: a slot darker than
// the page in light mode is lighter than it in dark mode, as raised surfaces
// are. Text becomes an off-white, tinted with its own hue or the page's,
// never pure white. Links keep their hue and get light enough to read, and
// the sidebar sits a little darker than the page.

import {
	contrast,
	fromLch,
	type LCH,
	parse,
	type RGBA,
	toHex,
	toLch,
} from "./color";
import { isCanvasOrigin } from "./settings";

type Preset = Record<string, unknown>;
type Resolve = (value: string) => string;

declare global {
	var __bcxDarkPreset:
		| ((preset: Preset, resolve?: Resolve) => Preset | undefined)
		| undefined;
}

// OKLCH lightness of the page, its text, and the clamps for the other slots.
const PAGE = 0.23;
const TEXT = 0.88;
const SURFACE_MIN = 0.16;
const SURFACE_MAX = 0.38;
const BORDER_MAX = 0.38;
const TEXT_MIN = 0.62;
const TEXT_MAX = 0.92;
// Text grayer than this is ink rather than a color, and takes the page's tint.
const GRAY = 0.07;

const COLOR =
	/#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b|(?:rgb|hsl)a?\([^)]*\)/gi;
const HAS_COLOR = new RegExp(COLOR.source, "i");
const URL_PART = /url\([^)]*\)/gi;

const clamp = (v: number, lo: number, hi: number) =>
	Math.min(hi, Math.max(lo, v));

type Role = (c: LCH) => LCH;

const isVisual = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && "visual_type" in v;

// Every color in a preset value through `map`, alpha kept. Values are colors,
// gradients and `url()` layers, `var()` references (resolved first), or the
// sidebar's and page's image objects.
function recolor(value: unknown, map: Role, resolve: Resolve): unknown {
	const one = (c: RGBA) => toHex(fromLch(map(toLch(c)), c.a));
	if (typeof value === "string") {
		const parts = value.split(URL_PART);
		const urls = value.match(URL_PART) ?? [];
		if (parts.some((p) => HAS_COLOR.test(p)))
			return parts
				.map((p, i) => {
					const out = p.replace(COLOR, (m) => {
						const c = parse(m);
						return c ? one(c) : m;
					});
					return i < urls.length ? out + urls[i] : out;
				})
				.join("");
		const c = parse(value.includes("var(") ? resolve(value) : value);
		return c ? one(c) : value;
	}
	if (isVisual(value)) {
		const out = { ...value };
		for (const key of ["color", "gradient_color", "image_overlay_color"])
			if (typeof out[key] === "string")
				out[key] = recolor(out[key], map, resolve);
		if (Array.isArray(out.overlay_colors))
			out.overlay_colors = out.overlay_colors.map((c) =>
				recolor(c, map, resolve),
			);
		return out;
	}
	return value;
}

// The first color in a value, as their Tb() reads the page color.
function firstColor(value: unknown, resolve: Resolve): RGBA | null {
	if (isVisual(value)) {
		const list = value.overlay_colors;
		value = (Array.isArray(list) && list[0]) || value.color;
	}
	if (typeof value !== "string") return null;
	const m = value.replace(URL_PART, "").match(COLOR);
	return parse(m?.[0] ?? (value.includes("var(") ? resolve(value) : value));
}

const resolveVar: Resolve = (value) => {
	const name = value.match(/var\((--[^),\s]+)/)?.[1];
	return name
		? getComputedStyle(document.documentElement).getPropertyValue(name).trim()
		: value;
};

export function darkPreset(light: Preset, resolve = resolveVar) {
	const page = firstColor(light["background-0"], resolve);
	if (!page) return;
	const paper = toLch(page);
	const ink = toLch(
		firstColor(light["text-0"], resolve) ?? { r: 0, g: 0, b: 0, a: 1 },
	);
	const darkPage = fromLch({
		...paper,
		l: PAGE,
		c: Math.min(paper.c * 0.5, 0.045),
	});

	// Surfaces and borders: light-mode distance from the page, inverted.
	const surface =
		(min: number, max: number): Role =>
		({ l, c, h }) => ({
			l: clamp(PAGE + (paper.l - l) * 0.45, min, max),
			c: Math.min(c * 0.5, 0.045),
			h,
		});
	const tint = ({ c, h }: LCH) =>
		c >= GRAY
			? { c: Math.min(c * 0.4, 0.03), h }
			: { c: Math.min(paper.c * 0.5, 0.02), h: paper.h };
	// Secondary text keeps its distance from the main text, inverted.
	const text: Role = (lch) => ({
		l: clamp(TEXT - (lch.l - ink.l) * 0.6, TEXT_MIN, TEXT_MAX),
		...tint(lch),
	});
	const sidebarText: Role = (lch) => ({ l: TEXT, ...tint(lch) });
	const link: Role = ({ c, h }) => {
		const chroma = Math.min(c, 0.12);
		let l = 0.78;
		while (l < 0.95 && contrast(fromLch({ l, c: chroma, h }), darkPage) < 6)
			l += 0.02;
		return { l, c: chroma, h };
	};
	const sidebar: Role = ({ l, c, h }) => ({
		l: 0.17 + 0.06 * l,
		c: Math.min(c * 0.6, 0.05),
		h,
	});

	const roles: Record<string, Role> = {
		"background-0": surface(SURFACE_MIN, SURFACE_MAX),
		"background-1": surface(SURFACE_MIN, SURFACE_MAX),
		"background-2": surface(SURFACE_MIN, SURFACE_MAX),
		"background-image": surface(SURFACE_MIN, SURFACE_MAX),
		cards: surface(SURFACE_MIN, SURFACE_MAX),
		borders: surface(PAGE, BORDER_MAX),
		"text-0": text,
		"text-1": text,
		"text-2": text,
		links: link,
		sidebar,
		"sidebar-text": sidebarText,
	};
	// Same slots as theirs (which also drops any others), plus the cards.
	const out: Preset = {};
	for (const [key, map] of Object.entries(roles))
		if (key in light)
			out[key] =
				light[key] == null ? light[key] : recolor(light[key], map, resolve);
	return out;
}

globalThis.__bcxDarkPreset = (preset, resolve) => {
	try {
		return darkPreset(preset, resolve);
	} catch (err) {
		console.error("[bcx] dark palette failed:", err);
	}
};

// Upstream's dark page color for a light one, as their Tb() computes it with
// the `color` package: HSL lightness cut by 40% (raised by 40% for colors its
// YIQ test calls dark), saturation set by how light the color was.
function upstreamPage({ r, g, b }: RGBA): RGBA {
	const [R, G, B] = [r / 255, g / 255, b / 255];
	const max = Math.max(R, G, B);
	const min = Math.min(R, G, B);
	const d = max - min;
	const hue = !d
		? 0
		: max === R
			? (G - B) / d
			: max === G
				? 2 + (B - R) / d
				: 4 + (R - G) / d;
	const h = (hue * 60 + 360) % 360;
	const l = ((max + min) / 2) * 100;
	const dark = (r * 2126 + g * 7152 + b * 722) / 10000 < 128;
	const L = (dark ? l * 1.4 : l * 0.6) / 100;
	const S = (l > 70 ? 10 : l > 50 ? 20 : l > 30 ? 25 : 30) / 100;
	const C = (1 - Math.abs(2 * L - 1)) * S;
	const X = C * (1 - Math.abs(((h / 60) % 2) - 1));
	const [x, y, z] = [
		[C, X, 0],
		[X, C, 0],
		[0, C, X],
		[0, X, C],
		[X, 0, C],
		[C, 0, X],
	][Math.floor(h / 60) % 6];
	const to8 = (v: number) => Math.round((v + L - C / 2) * 255);
	return { r: to8(x), g: to8(y), b: to8(z), a: 1 };
}

// A light theme applied before this build still has upstream's dark palette,
// until the theme is applied again. Swap in ours if the stored one is still
// exactly theirs: its page color is what Tb() makes from the light one. A
// palette edited since then keeps the edits. Runs once the page's styles
// have loaded, so a Canvas color the theme refers to by var() can resolve.
async function migrate() {
	const s = await browser.storage.local.get([
		"custom_domain",
		"theme_enabled",
		"default_preset",
		"light_preset",
		"dark_preset",
	]);
	const { light_preset: light, dark_preset: dark } = s;
	if (
		!isCanvasOrigin(s.custom_domain, location.origin) ||
		s.theme_enabled !== true ||
		s.default_preset !== "lighter" ||
		typeof light?.["background-0"] !== "string" ||
		typeof dark?.["background-0"] !== "string"
	)
		return;
	const from = parse(light["background-0"]);
	const was = parse(dark["background-0"]);
	if (!from || !was) return;
	const theirs = upstreamPage(from);
	if (
		Math.max(
			Math.abs(theirs.r - was.r),
			Math.abs(theirs.g - was.g),
			Math.abs(theirs.b - was.b),
		) > 1
	)
		return;
	const next = darkPreset(light);
	if (next) await browser.storage.local.set({ dark_preset: next });
}

if (window === window.top) {
	const run = () =>
		migrate().catch((err) =>
			console.warn("[bcx] dark palette update failed:", err),
		);
	if (document.readyState === "complete") run();
	else window.addEventListener("load", run, { once: true });
}
