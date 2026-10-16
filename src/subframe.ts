// What all.js does in a subframe, without loading all.js there. Before its
// main() gets to return for a subframe, all.js initializes every module of
// BetterCampus (React, its API schemas, Tailwind's class merger), about
// 300 ms per frame in our headless-Firefox measurements, on every site, for
// two small jobs that this file does instead:
//  - register the Figtree font, which the file viewer's UI (viewer.js, in
//    canvadocs frames) is set in;
//  - in an LMS page framed by the LMS itself, paint the anti-flicker styles
//    the top frame caches in that origin's localStorage, and lift them after
//    1.5 s, since a subframe never gets the full theme.
// The manifest gives all.js the top frame only and this script every frame.
// patches.json pins the upstream code mirrored here (group "subframe"), so a
// new upstream version that changes it fails the build.

const CACHE_KEY = "_bettercampus_theme_cache";
const NAV_SUPPRESSION_ID = "bettercampus-nav-suppression";
const SIDEBAR_WIDTH_ID = "bettercanvas-sidebar-width";
const SIDEBAR_READY = "data-bc-sidebar-ready";
const NAV_RESTORE = "data-bc-nav-restore";
const LIFT_AFTER = 1500;

const NAV_SUPPRESSION_CSS = `
	html:not([${NAV_RESTORE}]) #header > *:not(bettercampus-element) {
		opacity: 0 !important;
		pointer-events: none !important;
	}
`;

const sidebarWidthCss = (px: number) => `
	:root {
		--bcsidebarwidth: ${px}px;
	}

	body > #nav-tray-portal > span > span {
		left: var(--bcsidebarwidth, 200px) !important;
		transition: left 0.5s cubic-bezier(0.25, 0.1, 0.25, 1.0) !important;
	}

	#header {
		width: var(--bcsidebarwidth) !important;
		overflow-x: hidden !important;
		transition: width 0.5s cubic-bezier(0.25, 0.1, 0.25, 1.0) !important;
	}

	.tray-with-space-for-global-nav {
		margin-left: 0!important;
	}

	body.bettercampus-home-popup-open bettercanvas-sidebar::part(bettercanvas-sidebar-popup-btn) {
		opacity: 1!important;
		background-color: var(--bcbackground-0, #fff)!important;
	}

	body.bettercampus-home-popup-open bettercanvas-sidebar::part(bettercanvas-sidebar-popup-btn-txt) {
		color: var(--bctext-0, #273540)!important;
	}

	@media print {
		:root {
			--bcsidebarwidth: 0px !important;
		}
		#wrapper {
			margin-left: 0 !important;
		}
		#header.ic-app-header {
			display: none !important;
		}
	}
`;

const WRAPPER_CSS = `
	#wrapper {
		margin-left: var(--bcsidebarwidth) !important;
		max-width: 100% !important;
	}
`;

const FONTS = [
	{
		file: "/fonts/figtree-latin.woff2",
		unicodeRange:
			"U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
	},
	{
		file: "/fonts/figtree-latin-ext.woff2",
		unicodeRange:
			"U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF",
	},
];

// The cache is whatever the top frame stored; read it as loosely as theirs.
type ThemeCache = {
	custom_domain?: string[];
	theme_enabled?: boolean;
	bg?: string;
	dark_mode?: boolean;
	lms_type?: string;
	sidebar_enabled?: boolean;
	header_layout?: string;
	sidebar_width?: number;
} | null;

function readCache(): ThemeCache {
	try {
		const raw = localStorage.getItem(CACHE_KEY);
		return raw ? JSON.parse(raw) : {};
	} catch {
		return {};
	}
}

function appendStyle(css: string, id?: string) {
	const style = document.createElement("style");
	if (id) style.id = id;
	style.textContent = css;
	document.documentElement.appendChild(style);
	return style;
}

// Their Canvas sidebar hides the native nav until it's ready. A subframe
// never gets one, so the nav comes back once the timer runs out.
function suppressNav(theme: ThemeCache) {
	if (theme?.lms_type !== "canvas") return;
	if (theme?.sidebar_enabled === false) return;
	if (theme?.header_layout === "custom") return;
	if (!document.getElementById(NAV_SUPPRESSION_ID))
		appendStyle(NAV_SUPPRESSION_CSS, NAV_SUPPRESSION_ID);
	const width = theme?.sidebar_width;
	if (
		typeof width === "number" &&
		Number.isFinite(width) &&
		!document.getElementById(SIDEBAR_WIDTH_ID)
	)
		appendStyle(`${sidebarWidthCss(width)}${WRAPPER_CSS}`, SIDEBAR_WIDTH_ID);
	setTimeout(() => {
		if (document.documentElement.hasAttribute(SIDEBAR_READY)) return;
		document.documentElement.setAttribute(NAV_RESTORE, "");
		document.getElementById(SIDEBAR_WIDTH_ID)?.remove();
	}, LIFT_AFTER);
}

function antiFlicker() {
	try {
		const theme = readCache();
		const domains = theme?.custom_domain ?? [];
		if (!domains.some((d) => window.location.origin.includes(d))) return null;
		let css = "";
		if (theme?.theme_enabled && theme?.bg)
			css += `body,#wrapper,#main { background-color: ${theme?.bg}!important; }`;
		if (!theme?.theme_enabled && theme?.dark_mode)
			css += "body,#wrapper { background-color: #161616!important; }";
		const style = appendStyle(css);
		suppressNav(theme);
		return style;
	} catch {
		return null;
	}
}

if (window !== window.top) {
	const style = antiFlicker();
	if ("fonts" in document)
		for (const { file, unicodeRange } of FONTS)
			try {
				document.fonts.add(
					new FontFace(
						"Figtree",
						`url(${browser.runtime.getURL(file)}) format("woff2")`,
						{
							style: "normal",
							weight: "300 900",
							display: "swap",
							unicodeRange,
						},
					),
				);
			} catch {}
	if (style) setTimeout(() => style.remove(), LIFT_AFTER);
}
