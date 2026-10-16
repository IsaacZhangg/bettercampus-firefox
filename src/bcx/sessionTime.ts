// Time of day for planned focus sessions. BetterCampus only lets free plans
// plan a session for a whole day, so the time is ours: kept per session in
// `bcx_session_times` on top of their free all-day date, and picked in our own
// column that replaces their Pro time picker. Their stored plannedAt stays
// all-day; the session row asks `globalThis.__bcxSessionTime` for the time to
// show.

import { api, onFeature } from "./registry";
import { h } from "./ui";

type Times = Record<string, number>;

declare global {
	var __bcxSessionTime:
		| {
				subscribe(listener: () => void): () => void;
				get(id: string): number | null;
				at(
					plannedAt: string | null | undefined,
					minutes: number | null,
				): Date | null;
		  }
		| undefined;
}

const KEY = "bcx_session_times";
// Same slots their auto-planner uses for these names.
const PRESETS: [name: string, minutes: number][] = [
	["Morning", 600],
	["Afternoon", 840],
	["Evening", 1080],
	["Night", 1320],
];

let times: Times = {};
const listeners = new Set<() => void>();

const isMinutes = (v: unknown): v is number =>
	Number.isInteger(v) && (v as number) >= 0 && (v as number) < 1440;

function parse(raw: unknown): Times {
	const out: Times = {};
	for (const [id, m] of Object.entries(raw ?? {}))
		if (isMinutes(m)) out[id] = m;
	return out;
}

// Their all-day marker: midnight UTC on the planned date.
function isAllDay(plannedAt: string | null | undefined) {
	if (!plannedAt) return false;
	const d = new Date(plannedAt);
	return (
		d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0
	);
}

function at(plannedAt: string | null | undefined, minutes: number | null) {
	if (minutes == null || !isAllDay(plannedAt)) return null;
	const d = new Date(plannedAt as string);
	return new Date(
		d.getUTCFullYear(),
		d.getUTCMonth(),
		d.getUTCDate(),
		Math.floor(minutes / 60),
		minutes % 60,
	);
}

function setTimes(next: Times) {
	times = next;
	for (const fn of listeners) fn();
}

async function save(id: string, minutes: number | null) {
	const next = { ...times };
	if (minutes == null) delete next[id];
	else next[id] = minutes;
	setTimes(next);
	await api.storage.local.set({ [KEY]: next });
}

globalThis.__bcxSessionTime = {
	subscribe(listener) {
		listeners.add(listener);
		return () => listeners.delete(listener);
	},
	get: (id) => times[id] ?? null,
	at,
};

// Drop times whose session has since been removed.
api.storage.local.get([KEY, "overrides"]).then((stored) => {
	const saved = parse(stored[KEY]);
	const sessions = (stored.overrides ?? {}) as Record<
		string,
		{ isDeleted?: boolean } | undefined
	>;
	const live = Object.fromEntries(
		Object.entries(saved).filter(
			([id]) => sessions[id] && !sessions[id].isDeleted,
		),
	);
	setTimes(live);
	if (Object.keys(live).length !== Object.keys(saved).length)
		api.storage.local.set({ [KEY]: live });
});

api.storage.onChanged.addListener((changes, area) => {
	if (area === "local" && KEY in changes)
		setTimes(parse(changes[KEY].newValue));
});

const pad = (n: number) => String(n).padStart(2, "0");
const inputValue = (minutes: number) =>
	`${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
function label(minutes: number, h24: boolean) {
	if (h24) return inputValue(minutes);
	const hour = Math.floor(minutes / 60);
	return `${hour % 12 || 12}:${pad(minutes % 60)} ${hour < 12 ? "AM" : "PM"}`;
}

type PickerDetail = {
	feature: string;
	el: HTMLElement;
	id: string;
	plannedAt: string | null;
	h24: boolean;
	// Their free path: plans the session all-day (today when it has no date).
	pickAllDay: () => void;
};

// Their utility classes, so the column matches the calendar beside it.
const ALL_DAY =
	"my-2 text-sm py-1.5 px-6 rounded-md border border-transparent transition-colors self-center min-w-[140px]";
const OPTION =
	"cursor-pointer w-full h-8 flex items-center justify-between px-2 text-sm rounded-md transition-colors";
const SELECTED = "bg-theme-text-0 text-theme-bg-0 font-medium";
const UNSELECTED = "hover:bg-theme-2";

function createPicker(el: HTMLElement) {
	let cur: PickerDetail;

	const choose = (minutes: number | null) => {
		if (!isAllDay(cur.plannedAt)) cur.pickAllDay();
		save(cur.id, minutes);
	};

	const allDay = h(
		"button",
		{ type: "button", on: { click: () => choose(null) } },
		"All-Day",
	);
	const presets = PRESETS.map(([name, minutes]) => {
		const time = h("span", { class: "text-xs opacity-70 tabular-nums" });
		const button = h(
			"button",
			{ type: "button", on: { click: () => choose(minutes) } },
			h("span", {}, name),
			time,
		);
		return { button, time, minutes };
	});
	const exact = h("input", {
		type: "time",
		step: "300",
		"aria-label": "Exact time",
		class:
			"h-9 w-full rounded-xl border border-theme bg-theme-0 px-3 text-sm text-theme-0",
	});
	// An empty value is a half-typed time; All-Day is the way to clear it.
	exact.addEventListener("change", () => {
		if (!exact.value) return;
		const [hours, mins] = exact.value.split(":").map(Number);
		choose(hours * 60 + mins);
	});

	const divider = () => h("div", { class: "w-full h-px bg-theme-2" });
	el.append(
		allDay,
		divider(),
		h(
			"div",
			{ class: "p-1 flex flex-col gap-0.5" },
			h("p", { class: "px-2 pt-1 pb-1 text-xs text-theme-1" }, "Time of day"),
			...presets.map((p) => p.button),
		),
		divider(),
		h(
			"div",
			{ class: "p-2 flex flex-col gap-1" },
			h("p", { class: "px-1 text-xs text-theme-1" }, "Exact time"),
			exact,
		),
	);

	return (detail: PickerDetail) => {
		cur = detail;
		const minutes = isAllDay(cur.plannedAt) ? (times[cur.id] ?? null) : null;
		allDay.className = `${ALL_DAY} ${minutes == null ? SELECTED : "bg-theme-1 text-theme-0 hover:border-theme hover:bg-theme-2"}`;
		allDay.setAttribute("aria-pressed", String(minutes == null));
		for (const p of presets) {
			p.button.className = `${OPTION} ${p.minutes === minutes ? SELECTED : UNSELECTED}`;
			p.button.setAttribute("aria-pressed", String(p.minutes === minutes));
			p.time.textContent = label(p.minutes, cur.h24);
		}
		// Leave the field alone mid-edit; their row re-renders on every save.
		const root = exact.getRootNode() as Document | ShadowRoot;
		if (root.activeElement !== exact)
			exact.value = minutes == null ? "" : inputValue(minutes);
	};
}

const pickers = new WeakMap<HTMLElement, (d: PickerDetail) => void>();

// Their row calls this on every render with its fresh plannedAt.
onFeature<PickerDetail>("session_time_picker", (d) => {
	let update = pickers.get(d.el);
	if (!update) {
		update = createPicker(d.el);
		pickers.set(d.el, update);
	}
	update(d);
});
