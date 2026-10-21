// Checking an announcement off in BetterCampus's To-Do list only adds its id
// to their local `todo_read` list. Canvas still counts it as unread, so the
// badge on the course card's announcements icon kept counting it. This marks
// the announcement read in Canvas too (unread again when it's unchecked) and
// updates the card's badge on the page.
//
// Their checkbox stores only the id, and Canvas's API needs the course as
// well. The announcement's row links to /courses/<course>/discussion_topics/
// <id>, so the click on it is noted here first. A `todo_read` change reaches
// Canvas only when it matches a click on that row in this tab: other tabs, a
// settings restore or import, and a reset leave Canvas alone.

import { isCanvasOrigin } from "./settings";
import { h } from "./ui";

type Target = { course: string; topic: string };

const KEY = "todo_read";
// Their storage write follows the click within milliseconds.
const CLICK_TTL = 5000;
// How far above the clicked element the row can be. Their checkbox icon sits
// four levels below the element that also holds the title link.
const ROW_DEPTH = 8;
const TOPIC_PATH = /^\/courses\/(\d+)\/discussion_topics\/(\d+)\/?$/;

let onCanvas = false;
let clicked: (Target & { at: number }) | null = null;
let queue = Promise.resolve();

browser.storage.local.get("custom_domain").then((s) => {
	onCanvas = isCanvasOrigin(s.custom_domain, location.origin);
});

function topicsIn(el: Element) {
	const found = new Map<string, Target>();
	for (const a of el.querySelectorAll<HTMLAnchorElement>(
		'a[href*="/discussion_topics/"]',
	)) {
		const m = a.origin === location.origin && TOPIC_PATH.exec(a.pathname);
		if (m) found.set(m[2], { course: m[1], topic: m[2] });
	}
	return found;
}

// Their To-Do list renders in an open shadow root, so the path reaches the
// row. The nearest element with a topic link is the row; one holding several
// topics is a list, not a row.
document.addEventListener(
	"click",
	(e) => {
		if (!onCanvas) return;
		let depth = 0;
		for (const node of e.composedPath()) {
			if (!(node instanceof Element)) continue;
			if (++depth > ROW_DEPTH) return;
			const topics = [...topicsIn(node).values()];
			if (!topics.length) continue;
			if (topics.length === 1) clicked = { ...topics[0], at: Date.now() };
			return;
		}
	},
	true,
);

const csrf = () =>
	decodeURIComponent(
		/(?:^|;) *_csrf_token=([^;]*)/.exec(document.cookie)?.[1] ?? "",
	);

function newBadge(count: number) {
	return h(
		"span",
		{ class: "ic-DashboardCard__action-badge" },
		h("span", { class: "unread_count" }, String(count)),
		h("span", { class: "screenreader-only" }, "Unread"),
	);
}

// Canvas's badge is `.ic-DashboardCard__action-badge` around a
// `.unread_count`. Hiding it rather than removing it leaves the node Canvas's
// React renders in place.
function adjust(link: HTMLAnchorElement, delta: number) {
	const badge = link.querySelector<HTMLElement>(
		".ic-DashboardCard__action-badge",
	);
	const count = badge?.querySelector(".unread_count");
	const shown =
		!badge || badge.style.display === "none" ? 0 : Number(count?.textContent);
	if (!Number.isInteger(shown)) return; // "99+", or no count to change
	const next = Math.max(0, shown + delta);
	if (!badge) {
		if (next)
			(link.querySelector(".ic-DashboardCard__action-layout") ?? link).append(
				newBadge(next),
			);
		return;
	}
	if (!count) return;
	if (!next) {
		badge.style.setProperty("display", "none", "important");
		return;
	}
	count.textContent = String(next);
	badge.style.removeProperty("display");
}

async function setRead({ course, topic }: Target, read: boolean) {
	const url = `${location.origin}/api/v1/courses/${course}/discussion_topics/${topic}`;
	const res = await fetch(url, {
		credentials: "include",
		headers: { Accept: "application/json" },
	});
	if (!res.ok) throw new Error(`topic ${topic}: ${res.status}`);
	// Already the state they picked (read on Canvas before it was checked off,
	// say): the badge doesn't count it either way.
	if (((await res.json()).read_state === "read") === read) return;
	const set = await fetch(`${url}/read`, {
		method: read ? "PUT" : "DELETE",
		credentials: "include",
		headers: { "X-CSRF-Token": csrf() },
	});
	if (!set.ok) throw new Error(`topic ${topic}: ${set.status}`);
	const announcements = `/courses/${course}/announcements`;
	for (const link of document.querySelectorAll<HTMLAnchorElement>(
		"a.ic-DashboardCard__action",
	))
		if (
			link.origin === location.origin &&
			link.pathname.replace(/\/+$/, "") === announcements
		)
			adjust(link, read ? -1 : 1);
}

const ids = (v: unknown) => new Set(Array.isArray(v) ? v.map(String) : []);

browser.storage.onChanged.addListener((changes, area) => {
	if (area !== "local") return;
	if (changes.custom_domain)
		onCanvas = isCanvasOrigin(changes.custom_domain.newValue, location.origin);
	const change = changes[KEY];
	const target = clicked;
	if (!change || !target || Date.now() - target.at > CLICK_TTL) return;
	const read = ids(change.newValue).has(target.topic);
	if (read === ids(change.oldValue).has(target.topic)) return;
	clicked = null;
	queue = queue
		.then(() => setRead(target, read))
		.catch((err) =>
			console.warn("[bcx] couldn't update the announcement in Canvas:", err),
		);
});
