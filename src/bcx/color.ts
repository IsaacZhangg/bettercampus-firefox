// Color parsing and math shared by the dark-mode fixes: darkTheme.ts (Canvas's
// React pages) and darkPreset.ts (the dark palette made from a light theme).

export type RGBA = { r: number; g: number; b: number; a: number };
// OKLCH: perceptual lightness 0–1, chroma, hue in degrees.
export type LCH = { l: number; c: number; h: number };

let probe: CanvasRenderingContext2D | null | undefined;
const parsed = new Map<string, RGBA | null>();

// Any CSS color through the canvas parser, which serializes opaque colors to
// "#rrggbb" and others to "rgba(r, g, b, a)", and keeps the sentinel for what
// it can't parse (var(), keywords). It reads currentcolor as black, so that
// is skipped.
export function parse(value: string | null | undefined): RGBA | null {
	const v = value?.trim();
	if (!v || /currentcolor/i.test(v)) return null;
	let hit = parsed.get(v);
	if (hit !== undefined) return hit;
	probe ??= document.createElement("canvas").getContext("2d");
	if (!probe) return null;
	probe.fillStyle = "#010203";
	probe.fillStyle = v;
	const out = String(probe.fillStyle);
	const m = out.match(/^rgba\((.+)\)$/);
	hit = null;
	if (out.startsWith("#") && out !== "#010203")
		hit = {
			r: Number.parseInt(out.slice(1, 3), 16),
			g: Number.parseInt(out.slice(3, 5), 16),
			b: Number.parseInt(out.slice(5, 7), 16),
			a: 1,
		};
	else if (m) {
		const [r, g, b, a] = m[1].split(",").map(Number);
		hit = { r, g, b, a };
	}
	parsed.set(v, hit);
	return hit;
}

const linear = (c: number) => {
	const s = c / 255;
	return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

export function luminance({ r, g, b }: RGBA) {
	return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

export const contrast = (x: RGBA, y: RGBA) => {
	const [a, b] = [luminance(x), luminance(y)].sort((m, n) => n - m);
	return (a + 0.05) / (b + 0.05);
};

export const neutral = ({ r, g, b }: RGBA) =>
	(Math.max(r, g, b) - Math.min(r, g, b)) / 255 < 0.2;

export function toLch(c: RGBA): LCH {
	const [r, g, b] = [linear(c.r), linear(c.g), linear(c.b)];
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
	const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
	const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
	const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
	const h = (Math.atan2(B, A) * 180) / Math.PI;
	return { l: L, c: Math.hypot(A, B), h: h < 0 ? h + 360 : h };
}

// Linear sRGB, which may fall outside 0–1 for colors sRGB can't show.
function lchToLinear({ l, c, h }: LCH) {
	const A = c * Math.cos((h * Math.PI) / 180);
	const B = c * Math.sin((h * Math.PI) / 180);
	const L = l + 0.3963377774 * A + 0.2158037573 * B;
	const M = l - 0.1055613458 * A - 0.0638541728 * B;
	const S = l - 0.0894841775 * A - 1.291485548 * B;
	const [x, y, z] = [L ** 3, M ** 3, S ** 3];
	return [
		4.0767416621 * x - 3.3077115913 * y + 0.2309699292 * z,
		-1.2684380046 * x + 2.6097574011 * y - 0.3413193965 * z,
		-0.0041960863 * x - 0.7034186147 * y + 1.707614701 * z,
	];
}

const inGamut = (rgb: number[]) =>
	rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4);

// Lightness and hue are kept; chroma drops until sRGB can show the color.
export function fromLch(lch: LCH, a = 1): RGBA {
	let rgb = lchToLinear(lch);
	if (!inGamut(rgb)) {
		let [lo, hi] = [0, lch.c];
		for (let i = 0; i < 20; i++) {
			const mid = (lo + hi) / 2;
			if (inGamut(lchToLinear({ ...lch, c: mid }))) lo = mid;
			else hi = mid;
		}
		rgb = lchToLinear({ ...lch, c: lo });
	}
	const [r, g, b] = rgb.map((v) => {
		const x = Math.min(1, Math.max(0, v));
		const s = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
		return Math.round(s * 255);
	});
	return { r, g, b, a };
}

const hex2 = (n: number) => n.toString(16).padStart(2, "0");

export const toHex = ({ r, g, b, a }: RGBA) =>
	`#${hex2(r)}${hex2(g)}${hex2(b)}${a < 1 ? hex2(Math.round(a * 255)) : ""}`;
