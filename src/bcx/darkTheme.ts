// Fills the gaps BetterCampus's dark mode and themes leave on Canvas's React
// pages (discussions, New Quizzes, the newer assignment views). Their sheet
// is a fixed list of Canvas selectors, but InstUI components get hashed
// emotion classes (`.css-1x2y3z-view`) whose rules are inserted at runtime,
// so those panels stay white while their text turns light. We read those
// rules as they arrive and map light backgrounds, light borders and dark
// text onto the theme's variables. We also keep pasted post formatting
// (black text, white paragraph backgrounds) and @mentions readable.
// Everything is off while their `#darkcss` sheet is empty: dark mode and
// themes off, or Quiz Safe Mode on a quiz.

type RGBA = { r: number; g: number; b: number; a: number };

// "bc-" so their own stylesheet scan skips it, as it skips theirs.
const STYLE_ID = "bc-bcx-dark-fix";
const INK = "data-bcx-ink";
// Post bodies, and quoted replies, which Canvas renders outside them.
const ROOTS = '.user_content, [data-testid="reply-preview"]';
const IN = `:is(${ROOTS})`;
const INK_TARGETS = `${IN} :is([style*="color"], [style*="background"], font[color], [bgcolor], .mention)`;

const STATIC_CSS = `
${IN} [${INK}~="fg"] { color: inherit !important; }
${IN} [${INK}~="bg"] { background-color: transparent !important; }
${IN} [${INK}~="hl"], ${IN} [${INK}~="hl"] * { color: #1b1b1f !important; }
${IN} [${INK}~="hl-light"], ${IN} [${INK}~="hl-light"] * { color: #f5f5f5 !important; }
`;

// Canvas's stylesheet colors @mentions this purple, which vanishes on dark
// themes, so they are judged like an inline color.
const MENTION = "#5C1C78";

// The toggle knob and the color mixer's drag handles must stay white.
const SKIP_LABEL = /toggleFacade__icon|__indicator/;
const SIDES = [
	"top",
	"right",
	"bottom",
	"left",
	"block-end",
	"inline-start",
	"inline-end",
];

let probe: CanvasRenderingContext2D | null | undefined;
const parsed = new Map<string, RGBA | null>();

// Any CSS color through the canvas parser, which serializes opaque colors to
// "#rrggbb" and others to "rgba(r, g, b, a)", and keeps the sentinel for what
// it can't parse (var(), keywords). It reads currentcolor as black, so that
// is skipped.
function parse(value: string | null | undefined): RGBA | null {
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

function luminance({ r, g, b }: RGBA) {
	const lin = (c: number) => {
		const s = c / 255;
		return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

const contrast = (x: RGBA, y: RGBA) => {
	const [a, b] = [luminance(x), luminance(y)].sort((m, n) => n - m);
	return (a + 0.05) / (b + 0.05);
};

const neutral = ({ r, g, b }: RGBA) =>
	(Math.max(r, g, b) - Math.min(r, g, b)) / 255 < 0.2;

// The theme declarations for one InstUI rule, or "" if it needs none. A
// preset color left on "Use Canvas default" defines no variable, so each
// mapping falls back to the main slot, then to the rule's own color.
function themed(style: CSSStyleDeclaration, selector: string) {
	const out: string[] = [];
	const image = style.backgroundImage;
	const bg =
		!image || image === "none" || image === "initial"
			? parse(style.backgroundColor)
			: null;
	if (bg && bg.a >= 0.6) {
		const l = luminance(bg);
		if (l >= 0.55) {
			const main = `var(--bcbackground-0-ungradient, var(--bcbackground-0, ${style.backgroundColor}))`;
			const n = l >= 0.94 ? 0 : l >= 0.78 ? 1 : 2;
			out.push(
				`background-color: ${n ? `var(--bcbackground-${n}-ungradient, ${main})` : main} !important`,
			);
		}
	}
	const fg = parse(style.color);
	if (fg && fg.a >= 0.5) {
		const main = `var(--bctext-0, ${style.color})`;
		if (selector.includes("-link"))
			out.push(`color: var(--bclinks, ${style.color}) !important`);
		else if (neutral(fg) && luminance(fg) < 0.3)
			out.push(
				`color: ${luminance(fg) < 0.07 ? main : `var(--bctext-2, ${main})`} !important`,
			);
	}
	// ContextView arrows set border-color, then turn the inline sides
	// transparent; a left/right override would beat that and fill them in.
	const logical =
		style.getPropertyValue("border-inline-start-color") ||
		style.getPropertyValue("border-inline-end-color");
	for (const side of SIDES) {
		if (logical && (side === "left" || side === "right")) continue;
		const raw = style.getPropertyValue(`border-${side}-color`);
		const c = parse(raw);
		if (c && c.a >= 0.5 && neutral(c) && luminance(c) >= 0.45)
			out.push(`border-${side}-color: var(--bcborders, ${raw}) !important`);
	}
	return out.join("; ");
}

const scanned = new WeakMap<CSSStyleSheet, number>();
const overrides = new Set<string>();

// Emotion appends rules to its existing <style> tags, so each sheet is
// resumed from where the last scan stopped. InstUI puts no colors inside
// @media blocks, so only top-level rules are read.
function scanSheets() {
	for (const sheet of Array.from(document.styleSheets)) {
		const owner = sheet.ownerNode;
		if (
			owner instanceof Element &&
			(owner.id === "darkcss" || /^(bc-|bettercanvas)/.test(owner.id))
		)
			continue;
		let rules: CSSRuleList;
		try {
			rules = sheet.cssRules;
		} catch {
			continue; // cross-origin sheet
		}
		const done = scanned.get(sheet) ?? 0;
		for (let i = rules.length < done ? 0 : done; i < rules.length; i++) {
			const rule = rules[i];
			if (!(rule instanceof CSSStyleRule)) continue;
			const sel = rule.selectorText;
			if (!sel.includes(".css-") || SKIP_LABEL.test(sel)) continue;
			const decls = themed(rule.style, sel);
			if (decls) overrides.add(`${sel} { ${decls}; }`);
		}
		scanned.set(sheet, rules.length);
	}
}

// The theme's page background and post text color. background-0 can be a
// gradient or image layer, so take its first color; body text is their
// text-1, the same as posts.
function palette() {
	const root = getComputedStyle(document.documentElement);
	const body = getComputedStyle(document.body);
	const first = (name: string) =>
		parse(
			root
				.getPropertyValue(name)
				.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/i)?.[0],
		);
	const bg =
		first("--bcbackground-0-ungradient") ??
		first("--bcbackground-0") ??
		parse(body.backgroundColor);
	const text = parse(body.color);
	return bg && text ? { bg, text } : null;
}

const inlineBg = (el: HTMLElement) => {
	const c = parse(el.style.backgroundColor || el.getAttribute("bgcolor"));
	return c && c.a >= 0.5 ? c : null;
};

// What an element's text sits on: the nearest inline background we keep, the
// page, or null under a highlight (which sets its own text color).
function backdrop(el: HTMLElement, own: string[], page: RGBA) {
	if (own.some((m) => m.startsWith("hl"))) return null;
	const bg = inlineBg(el);
	if (bg && !own.includes("bg")) return bg;
	for (
		let node = el.parentElement;
		node && !node.matches(ROOTS);
		node = node.parentElement
	) {
		const ink = node.getAttribute(INK) ?? "";
		if (ink.includes("hl")) return null;
		const c = inlineBg(node);
		if (c && !ink.includes("bg")) return c;
	}
	return page;
}

// Pasted formatting in posts. White "paper" backgrounds are dropped; colored
// highlights keep their color with dark text on top from about the luminance
// where dark text out-reads light (their sheet gives one highlight color the
// page background as text, which vanishes on light themes); other
// backgrounds the theme's text can't be read on get light or dropped, unless
// the element brings its own readable text color; and text colors that
// disappear against what they sit on fall back to the theme's text color.
function markInk() {
	// Document order, so an element's ancestors are already marked.
	const targets = document.querySelectorAll<HTMLElement>(INK_TARGETS);
	// palette() forces a style flush, so skip it on pages with nothing to mark.
	if (!targets.length) return;
	const pal = palette();
	if (!pal) return;
	for (const el of targets) {
		const marks: string[] = [];
		const bg = inlineBg(el);
		const color = parse(
			el.style.color ||
				el.getAttribute("color") ||
				(el.classList.contains("mention") ? MENTION : ""),
		);
		const fg = color && color.a > 0.3 ? color : null;
		const paired = !!bg && !!fg && contrast(fg, bg) >= 3;
		const unreadable = !!bg && !paired && contrast(bg, pal.text) < 3;
		if (bg && !neutral(bg)) {
			if (luminance(bg) >= (paired ? 0.4 : 0.2)) marks.push("hl");
			else if (unreadable) marks.push("hl-light");
		} else if (bg && (luminance(bg) >= 0.9 || unreadable)) marks.push("bg");
		const under = fg ? backdrop(el, marks, pal.bg) : null;
		if (fg && under && contrast(fg, under) < 3) marks.push("fg");
		const next = marks.join(" ");
		if ((el.getAttribute(INK) ?? "") === next) continue;
		if (next) el.setAttribute(INK, next);
		else el.removeAttribute(INK);
	}
}

const style = document.createElement("style");
style.id = STYLE_ID;
let queued = false;
let wasActive = false;

function run() {
	queued = false;
	const active = !!document.getElementById("darkcss")?.textContent;
	const known = overrides.size;
	// The rules only matter while active. Sheets resume from where the last
	// scan stopped, so turning it on catches up on everything added meanwhile.
	if (active) {
		scanSheets();
		markInk();
	}
	if (overrides.size !== known || active !== wasActive) {
		style.textContent = active ? STATIC_CSS + [...overrides].join("\n") : "";
		wasActive = active;
	}
}

const schedule = () => {
	if (queued) return;
	queued = true;
	requestAnimationFrame(run);
};

function begin() {
	document.head.append(style);
	new MutationObserver(schedule).observe(document.documentElement, {
		childList: true,
		subtree: true,
	});
	schedule();
}

// Their sheet only appears on LMS pages, so other sites cost one head
// observer and nothing more.
function start() {
	if (document.getElementById("darkcss")) return begin();
	const wait = new MutationObserver(() => {
		if (!document.getElementById("darkcss")) return;
		wait.disconnect();
		begin();
	});
	wait.observe(document.head, { childList: true });
}

if (window === window.top) {
	if (document.readyState === "loading")
		document.addEventListener("DOMContentLoaded", start, { once: true });
	else start();
}
