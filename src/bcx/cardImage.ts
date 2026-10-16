// Image editor for course-card, sidebar and background images: crop by
// panning, zoom, rotate, flip and filter presets, all baked into the output
// pixels. Replaces BetterCampus's Pro cropper; the result is saved through the
// same setter their free "paste an image URL" path uses.

import { onFeature } from "./registry";
import { BASE_CSS, h, mountLayer } from "./ui";

type ImageType = "card" | "sidebar" | "background";

type Detail = {
	feature: "cardImageEditing";
	imageSrc: string;
	imageType: ImageType;
	animated: boolean;
	container?: Element | null;
	save: (dataUrl: string) => void;
	cancel: () => void;
};

const OUTPUT: Record<ImageType, [number, number]> = {
	card: [420, 260],
	sidebar: [200, 1200],
	background: [1920, 1080],
};

type Look = { css: (t: number, px: number) => string; tint?: [string, number] };

// Our own presets. `t` is intensity in [0, 1]; `px` scales blur radii to the
// canvas being drawn so previews and output match.
const PRESETS: Record<string, { label: string } & Look> = {
	none: { label: "None", css: () => "none" },
	vivid: {
		label: "Vivid",
		css: (t) => `saturate(${1 + 0.6 * t}) contrast(${1 + 0.1 * t})`,
	},
	warm: {
		label: "Warm",
		css: (t) =>
			`sepia(${0.25 * t}) saturate(${1 + 0.3 * t}) brightness(${1 + 0.03 * t})`,
		tint: ["#ff9a3c", 0.12],
	},
	cool: {
		label: "Cool",
		css: (t) => `saturate(${1 - 0.1 * t}) brightness(${1 + 0.02 * t})`,
		tint: ["#3c8cff", 0.14],
	},
	mono: { label: "Mono", css: (t) => `grayscale(${t})` },
	noir: {
		label: "Noir",
		css: (t) =>
			`grayscale(${t}) contrast(${1 + 0.45 * t}) brightness(${1 - 0.12 * t})`,
	},
	vintage: {
		label: "Vintage",
		css: (t) =>
			`sepia(${0.35 * t}) contrast(${1 - 0.12 * t}) brightness(${1 + 0.08 * t}) saturate(${1 - 0.2 * t})`,
	},
	dramatic: {
		label: "Dramatic",
		css: (t) =>
			`contrast(${1 + 0.35 * t}) saturate(${1 + 0.15 * t}) brightness(${1 - 0.06 * t})`,
	},
	fade: {
		label: "Fade",
		css: (t) =>
			`contrast(${1 - 0.25 * t}) brightness(${1 + 0.12 * t}) saturate(${1 - 0.35 * t})`,
	},
	dreamy: {
		label: "Dreamy",
		css: (t, px) =>
			`blur(${1.2 * t * px}px) brightness(${1 + 0.2 * t}) saturate(${1 - 0.2 * t})`,
		tint: ["#ffffff", 0.08],
	},
	sunset: {
		label: "Sunset",
		css: (t) => `saturate(${1 + 0.4 * t}) contrast(${1 + 0.08 * t})`,
		tint: ["#ff5a1f", 0.16],
	},
	ocean: {
		label: "Ocean",
		css: (t) => `saturate(${1 + 0.15 * t}) brightness(${1 - 0.08 * t})`,
		tint: ["#1f6bff", 0.2],
	},
};

type State = {
	zoom: number;
	dx: number; // pan offset, in fractions of the frame width/height
	dy: number;
	rot: 0 | 90 | 180 | 270;
	flipX: boolean;
	flipY: boolean;
	filter: string;
	intensity: number; // 0-100
};

const fresh = (): State => ({
	zoom: 1,
	dx: 0,
	dy: 0,
	rot: 0,
	flipX: false,
	flipY: false,
	filter: "none",
	intensity: 100,
});

function rotatedSize(img: HTMLImageElement, s: State) {
	const sideways = s.rot === 90 || s.rot === 270;
	return sideways
		? [img.naturalHeight, img.naturalWidth]
		: [img.naturalWidth, img.naturalHeight];
}

// Keep the image covering the whole frame: pan can't reveal empty edges.
function clamp(img: HTMLImageElement, s: State, fw: number, fh: number) {
	const [rw, rh] = rotatedSize(img, s);
	const scale = Math.max(fw / rw, fh / rh) * s.zoom;
	const maxX = Math.max(0, (rw * scale - fw) / 2 / fw);
	const maxY = Math.max(0, (rh * scale - fh) / 2 / fh);
	s.dx = Math.min(maxX, Math.max(-maxX, s.dx));
	s.dy = Math.min(maxY, Math.max(-maxY, s.dy));
}

// Draws the frame contents at any size; previews and the saved file share it.
function draw(
	ctx: CanvasRenderingContext2D,
	img: HTMLImageElement,
	s: State,
	w: number,
	h: number,
	look = s,
) {
	const [rw, rh] = rotatedSize(img, s);
	const scale = Math.max(w / rw, h / rh) * s.zoom;
	const preset = PRESETS[look.filter] ?? PRESETS.none;
	const t = look.intensity / 100;
	const px = w / 420;
	ctx.save();
	ctx.clearRect(0, 0, w, h);
	ctx.filter = preset.css(t, px);
	ctx.translate(w / 2 + s.dx * w, h / 2 + s.dy * h);
	ctx.scale(s.flipX ? -1 : 1, s.flipY ? -1 : 1);
	ctx.rotate((s.rot * Math.PI) / 180);
	const iw = img.naturalWidth * scale;
	const ih = img.naturalHeight * scale;
	ctx.drawImage(img, -iw / 2, -ih / 2, iw, ih);
	ctx.restore();
	if (preset.tint && t > 0) {
		ctx.save();
		ctx.globalAlpha = preset.tint[1] * t;
		ctx.globalCompositeOperation = "soft-light";
		ctx.fillStyle = preset.tint[0];
		ctx.fillRect(0, 0, w, h);
		ctx.restore();
	}
}

async function toDataUrl(src: string): Promise<string> {
	if (src.startsWith("data:")) return src;
	const blob = await (await fetch(src)).blob();
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result as string);
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(blob);
	});
}

function loadImage(src: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => resolve(img);
		img.onerror = () => reject(new Error("Couldn't load the image"));
		img.src = src;
	});
}

function exportImage(img: HTMLImageElement, s: State, type: ImageType) {
	const [w, hgt] = OUTPUT[type];
	const canvas = document.createElement("canvas");
	canvas.width = w;
	canvas.height = hgt;
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("Canvas unavailable");
	draw(ctx, img, s, w, hgt);
	return canvas.toDataURL("image/webp", 0.92);
}

const CSS = `${BASE_CSS}
.panel { padding: 20px; display: grid; gap: 14px; }
.head { display: flex; align-items: center; justify-content: space-between; }
.head h2 { margin: 0; font-size: 18px; font-weight: 700; }
.stage { display: grid; place-items: center; background: var(--bcbackground-1, #f2f1f4); border-radius: 14px; padding: 14px; }
.frame { position: relative; border-radius: 10px; overflow: hidden; cursor: grab; touch-action: none; box-shadow: 0 0 0 1px rgb(0 0 0 / .08); }
.frame.dragging { cursor: grabbing; }
.frame canvas { display: block; width: 100%; height: 100%; }
.grid { position: absolute; inset: 0; pointer-events: none; opacity: 0; transition: opacity .15s;
  background-image: linear-gradient(to right, rgb(255 255 255 / .5) 1px, transparent 1px), linear-gradient(to bottom, rgb(255 255 255 / .5) 1px, transparent 1px);
  background-size: calc(100% / 3) calc(100% / 3); }
.frame.dragging .grid { opacity: 1; }
.row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.row label { font-size: 13px; font-weight: 600; color: var(--bctext-1, #777); min-width: 64px; }
.row input[type=range] { flex: 1; min-width: 140px; }
.spacer { flex: 1; }
.filters { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 4px; }
.filter { appearance: none; border: 2px solid transparent; background: none; padding: 0; cursor: pointer; border-radius: 10px; display: grid; gap: 4px; font-size: 11px; font-weight: 600; color: var(--bctext-1, #777); text-align: center; }
.filter canvas { width: 72px; height: 46px; border-radius: 8px; display: block; }
.filter.active { border-color: #4c46f0; color: #4c46f0; }
.note { font-size: 13px; background: color-mix(in srgb, #f5b82e 14%, var(--bcbackground-0-ungradient, #fff)); border: 1px solid color-mix(in srgb, #f5b82e 45%, var(--bcbackground-0-ungradient, #fff)); border-radius: 10px; padding: 8px 12px; }
.err { font-size: 13px; color: #e5484d; }
.foot { display: flex; justify-content: flex-end; gap: 8px; }
`;

let open: { src: string; close: () => void } | null = null;
let loading: string | null = null;

// Their component calls us on every render while its cropper state is open;
// keep one editor per image.
onFeature<Detail>("cardImageEditing", async (d) => {
	if (open?.src === d.imageSrc || loading === d.imageSrc) return;
	open?.close();
	loading = d.imageSrc;
	try {
		// Their cleanup revokes the blob URL, so take our own copy first.
		const src = await toDataUrl(d.imageSrc);
		openEditor(d, src, await loadImage(src));
	} catch (err) {
		d.cancel();
		throw err;
	} finally {
		loading = null;
	}
});

function openEditor(d: Detail, src: string, img: HTMLImageElement) {
	const type: ImageType = d.imageType in OUTPUT ? d.imageType : "card";
	const [outW, outH] = OUTPUT[type];
	const s = fresh();

	const maxW = Math.min(560, window.innerWidth - 120);
	const maxH = Math.min(420, window.innerHeight * 0.5);
	const fit = Math.min(maxW / outW, maxH / outH);
	const fw = Math.round(outW * fit);
	const fh = Math.round(outH * fit);
	const dpr = window.devicePixelRatio || 1;

	const preview = h("canvas", {
		width: Math.round(fw * dpr),
		height: Math.round(fh * dpr),
	});
	const frame = h(
		"div",
		{ class: "frame", style: `width:${fw}px;height:${fh}px` },
		preview,
		h("div", { class: "grid" }),
	);
	const zoom = h("input", {
		type: "range",
		min: "1",
		max: "5",
		step: "0.01",
		value: "1",
		"aria-label": "Zoom",
	});
	const intensity = h("input", {
		type: "range",
		min: "0",
		max: "100",
		step: "1",
		value: "100",
		"aria-label": "Filter intensity",
	});
	const intensityRow = h(
		"div",
		{ class: "row", hidden: true },
		h("label", {}, "Intensity"),
		intensity,
	);
	const error = h("div", { class: "err", hidden: true });
	const saveBtn = h("button", { class: "btn primary" }, "Save");

	const render = () => {
		clamp(img, s, fw, fh);
		const ctx = preview.getContext("2d");
		if (ctx) draw(ctx, img, s, preview.width, preview.height);
		zoom.value = String(s.zoom);
		intensityRow.hidden = s.filter === "none";
	};

	const thumbs = Object.entries(PRESETS).map(([id, preset]) => {
		const c = h("canvas", { width: "144", height: "92" });
		const ctx = c.getContext("2d");
		if (ctx)
			draw(ctx, img, fresh(), 144, 92, {
				...fresh(),
				filter: id,
				intensity: 100,
			});
		const btn = h(
			"button",
			{
				class: `filter${id === s.filter ? " active" : ""}`,
				on: {
					click: () => {
						s.filter = id;
						for (const b of thumbsRow.children)
							b.classList.toggle("active", b === btn);
						render();
					},
				},
			},
			c,
			preset.label,
		);
		return btn;
	});
	const thumbsRow = h("div", { class: "filters" }, ...thumbs);

	const step = (patch: () => Partial<State>) => () => {
		Object.assign(s, patch());
		render();
	};

	const layer = mountLayer(CSS, d.container);
	const close = () => {
		layer.remove();
		window.removeEventListener("keydown", onKey, true);
		if (open?.close === close) open = null;
	};
	const cancel = () => {
		close();
		d.cancel();
	};
	const onKey = (e: KeyboardEvent) => {
		if (e.key !== "Escape") return;
		e.stopPropagation();
		cancel();
	};
	window.addEventListener("keydown", onKey, true);
	open = { src: d.imageSrc, close };

	saveBtn.addEventListener("click", () => {
		try {
			const out = exportImage(img, s, type);
			close();
			d.save(out);
		} catch (err) {
			error.textContent = `Couldn't save: ${(err as Error).message}`;
			error.hidden = false;
		}
	});

	const panel = h(
		"div",
		{
			class: "panel",
			style: `width:min(${Math.max(fw, 380) + 68}px, 100%)`,
			role: "dialog",
			"aria-modal": "true",
			"aria-label": "Edit image",
		},
		h(
			"div",
			{ class: "head" },
			h("h2", {}, "Edit image"),
			h(
				"button",
				{ class: "btn icon", "aria-label": "Close", on: { click: cancel } },
				"✕",
			),
		),
		d.animated &&
			h(
				"div",
				{ class: "note" },
				"This image is animated. Saving edits keeps a still frame — use “Keep animation” to save it unedited.",
			),
		h("div", { class: "stage" }, frame),
		h(
			"div",
			{ class: "row" },
			h("label", {}, "Zoom"),
			h(
				"button",
				{
					class: "btn icon",
					"aria-label": "Zoom out",
					on: { click: step(() => ({ zoom: Math.max(1, s.zoom - 0.25) })) },
				},
				"−",
			),
			zoom,
			h(
				"button",
				{
					class: "btn icon",
					"aria-label": "Zoom in",
					on: { click: step(() => ({ zoom: Math.min(5, s.zoom + 0.25) })) },
				},
				"+",
			),
		),
		h(
			"div",
			{ class: "row" },
			h("label", {}, "Transform"),
			h(
				"button",
				{
					class: "btn icon",
					"aria-label": "Rotate left",
					on: {
						click: step(() => ({ rot: ((s.rot + 270) % 360) as State["rot"] })),
					},
				},
				"↺",
			),
			h(
				"button",
				{
					class: "btn icon",
					"aria-label": "Rotate right",
					on: {
						click: step(() => ({ rot: ((s.rot + 90) % 360) as State["rot"] })),
					},
				},
				"↻",
			),
			h(
				"button",
				{
					class: "btn icon",
					"aria-label": "Flip horizontally",
					on: { click: step(() => ({ flipX: !s.flipX })) },
				},
				"⇋",
			),
			h(
				"button",
				{
					class: "btn icon",
					"aria-label": "Flip vertically",
					on: { click: step(() => ({ flipY: !s.flipY })) },
				},
				"⇵",
			),
			h("div", { class: "spacer" }),
			h(
				"button",
				{
					class: "btn",
					on: {
						click: step(() => {
							for (const b of thumbsRow.children)
								b.classList.toggle("active", b === thumbs[0]);
							intensity.value = "100";
							return fresh();
						}),
					},
				},
				"Reset",
			),
		),
		thumbsRow,
		intensityRow,
		error,
		h(
			"div",
			{ class: "foot" },
			d.animated &&
				h(
					"button",
					{
						class: "btn",
						on: {
							click: () => {
								close();
								d.save(src);
							},
						},
					},
					"Keep animation",
				),
			h("button", { class: "btn", on: { click: cancel } }, "Cancel"),
			saveBtn,
		),
	);
	const scrim = h("div", { class: "scrim" }, panel);
	scrim.addEventListener("pointerdown", (e) => {
		if (e.target === scrim) cancel();
	});
	layer.root.append(scrim);

	zoom.addEventListener("input", () => {
		s.zoom = Number(zoom.value);
		render();
	});
	intensity.addEventListener("input", () => {
		s.intensity = Number(intensity.value);
		render();
	});
	frame.addEventListener(
		"wheel",
		(e) => {
			e.preventDefault();
			s.zoom = Math.min(5, Math.max(1, s.zoom * Math.exp(-e.deltaY / 500)));
			render();
		},
		{ passive: false },
	);
	frame.addEventListener("pointerdown", (e) => {
		frame.setPointerCapture(e.pointerId);
		frame.classList.add("dragging");
		const start = { x: e.clientX, y: e.clientY, dx: s.dx, dy: s.dy };
		const move = (ev: PointerEvent) => {
			s.dx = start.dx + (ev.clientX - start.x) / fw;
			s.dy = start.dy + (ev.clientY - start.y) / fh;
			render();
		};
		const up = () => {
			frame.classList.remove("dragging");
			frame.removeEventListener("pointermove", move);
			frame.removeEventListener("pointerup", up);
			frame.removeEventListener("pointercancel", up);
		};
		frame.addEventListener("pointermove", move);
		frame.addEventListener("pointerup", up);
		frame.addEventListener("pointercancel", up);
	});

	render();
	saveBtn.focus();
}
