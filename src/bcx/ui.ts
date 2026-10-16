type Child = Node | string | null | undefined | false;
type Props = {
	class?: string;
	style?: string;
	on?: Partial<Record<keyof HTMLElementEventMap, (e: Event) => void>>;
	[attr: string]: unknown;
};

export function h<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	props: Props = {},
	...children: Child[]
): HTMLElementTagNameMap[K] {
	const el = document.createElement(tag);
	for (const [key, value] of Object.entries(props)) {
		if (key === "on") {
			for (const [type, fn] of Object.entries((value as Props["on"]) ?? {}))
				el.addEventListener(type, fn as EventListener);
		} else if (key === "class") el.className = value as string;
		else if (value === true) el.setAttribute(key, "");
		else if (value !== false && value != null)
			el.setAttribute(key, String(value));
	}
	for (const child of children) if (child) el.append(child);
	return el;
}

export const FONT =
	'"Figtree", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';

// Full-viewport layer in its own shadow root. Mounting inside the caller's
// portal container (when given) keeps BetterCampus's menu treating clicks as
// "inside", the same as the modal it replaces.
export function mountLayer(css: string, container?: Element | null) {
	const host = h("div", {
		style:
			"position:fixed;inset:0;z-index:2147483647;display:block;contain:layout",
	});
	const root = host.attachShadow({ mode: "open" });
	root.append(h("style", {}, css));
	(container?.isConnected ? container : document.documentElement).append(host);
	return { host, root, remove: () => host.remove() };
}

// Panels use the same theme variables as BetterCampus's own UI (`bg-theme-0`
// etc.), which reach into our shadow roots because custom properties inherit;
// the fallbacks are their light defaults.
export const BASE_CSS = `
:host { all: initial; }
[hidden] { display: none !important; }
* { box-sizing: border-box; font-family: ${FONT}; }
.scrim { position: fixed; inset: 0; background: rgb(15 15 20 / .45); display: grid; place-items: center; padding: 16px; }
.panel { background: var(--bcbackground-0, #fff); color: var(--bctext-0, #273540); border: 1px solid var(--bcborders, #d7d5dd); border-radius: 18px; box-shadow: 0 24px 64px rgb(0 0 0 / .28); max-width: 100%; max-height: 100%; overflow: auto; }
.btn { appearance: none; border: 1px solid var(--bcborders, #d7d5dd); background: var(--bcbackground-1, #f2f1f4); color: inherit; border-radius: 10px; padding: 8px 14px; font-size: 14px; font-weight: 600; cursor: pointer; }
.btn:hover { background: var(--bcbackground-2, #d7d5dd); }
.btn:disabled { opacity: .5; cursor: default; }
.btn.primary { background: #4c46f0; border-color: #4c46f0; color: #fff; box-shadow: inset 0 -3px 0 rgb(0 0 0 / .18); }
.btn.primary:hover { background: #3f39dc; }
.icon { width: 36px; height: 36px; padding: 0; display: inline-grid; place-items: center; font-size: 17px; }
input[type=range] { accent-color: #4c46f0; }
`;
