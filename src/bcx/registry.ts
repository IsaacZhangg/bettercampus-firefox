// Our own implementations of the features BetterCampus gates behind Pro.
// Their locked controls are patched (patches.json, group "bcx") to call
// `globalThis.__bcx(...)` instead of opening the paywall; nothing here runs or
// re-enables their gated code paths.

export type FeatureDetail = { feature: string };

declare global {
	var __bcx: ((detail: FeatureDetail) => void) | undefined;
}

// biome-ignore lint/suspicious/noExplicitAny: each handler narrows its own detail
const handlers = new Map<string, (detail: any) => void | Promise<void>>();

export function onFeature<T extends FeatureDetail>(
	feature: string,
	handler: (detail: T) => void | Promise<void>,
) {
	handlers.set(feature, handler);
}

// The content-script global is shared with all.js but invisible to the page,
// so pages can't call this the way they could dispatch a window event.
globalThis.__bcx = (detail) => {
	const handler = handlers.get(detail?.feature);
	if (!handler) return;
	Promise.resolve(handler(detail)).catch((err) =>
		console.error(`[bcx] ${detail.feature} failed:`, err),
	);
};
