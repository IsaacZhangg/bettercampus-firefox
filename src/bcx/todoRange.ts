// Custom To-Do range: a rolling window of N days, weeks or months starting
// today, with the arrows moving it by the same length. Replaces BetterCampus's
// Pro "Custom" timeframe. The range lives in our own storage; while it's
// active the list provider asks `globalThis.__bcxTodoRange` for its date range
// and step instead of using its timeframe presets.

import { api, onFeature } from "./registry";
import { BASE_CSS, h, mountLayer } from "./ui";

type Unit = "days" | "weeks" | "months";
type Range = { value: number; unit: Unit };
type Window = { start: Date; end: Date };

declare global {
	var __bcxTodoRange:
		| {
				active: true;
				label: string;
				range(start: Date): Window;
				step(start: Date, dir: "next" | "previous"): Date;
		  }
		| undefined;
}

const KEY = "bcx_todo_range";
const MAX: Record<Unit, number> = { days: 30, weeks: 25, months: 6 };
const UNIT_LABEL: Record<Unit, [string, string]> = {
	days: ["Day", "Days"],
	weeks: ["Week", "Weeks"],
	months: ["Month", "Months"],
};

const startOfDay = (d: Date) =>
	new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => {
	const out = new Date(d);
	out.setDate(out.getDate() + n);
	return out;
};
// Month math that clamps to the last day (Jan 31 + 1 month = Feb 28/29).
const addMonths = (d: Date, n: number) => {
	const out = new Date(d);
	const day = out.getDate();
	out.setDate(1);
	out.setMonth(out.getMonth() + n);
	const last = new Date(out.getFullYear(), out.getMonth() + 1, 0).getDate();
	out.setDate(Math.min(day, last));
	return out;
};

const shift = (d: Date, r: Range, times: number) =>
	r.unit === "months"
		? addMonths(d, r.value * times)
		: addDays(d, r.value * times * (r.unit === "weeks" ? 7 : 1));

const label = (r: Range) =>
	`${r.value} ${UNIT_LABEL[r.unit][r.value === 1 ? 0 : 1]}`;

function isRange(v: unknown): v is Range {
	const r = v as Range;
	return (
		!!r &&
		r.unit in MAX &&
		Number.isInteger(r.value) &&
		r.value >= 1 &&
		r.value <= MAX[r.unit]
	);
}

let current: Range | null = null;
let setStartDate: ((d: Date) => void) | null = null;

function publish() {
	const r = current;
	globalThis.__bcxTodoRange = r
		? {
				active: true,
				label: label(r),
				range: (start) => {
					const from = startOfDay(start);
					return { start: from, end: shift(from, r, 1) };
				},
				step: (start, dir) => shift(start, r, dir === "next" ? 1 : -1),
			}
		: undefined;
}

// Re-renders their list (and reloads its data) from today, the same reset
// their own timeframe changes do.
const refresh = () => setStartDate?.(new Date());

async function apply(r: Range | null) {
	current = r;
	publish();
	refresh();
	await api.storage.local.set({ [KEY]: r });
}

api.storage.local.get(KEY).then((stored) => {
	current = isRange(stored[KEY]) ? stored[KEY] : null;
	publish();
	if (current) refresh();
});

api.storage.onChanged.addListener((changes, area) => {
	if (area !== "local") return;
	if (KEY in changes) {
		const next = changes[KEY].newValue;
		current = isRange(next) ? next : null;
		publish();
		refresh();
	}
	// Picking Day/Week/Month anywhere (dashboard header or settings) ends ours.
	if ("todo_time" in changes && current) apply(null);
});

const CSS = `${BASE_CSS}
.panel { width: min(360px, 100%); padding: 20px; display: grid; gap: 14px; }
h2 { margin: 0; font-size: 17px; font-weight: 700; }
p { margin: 0; font-size: 13px; color: var(--bctext-1, #777); line-height: 1.45; }
.row { display: flex; gap: 8px; }
input, select { font: inherit; font-size: 14px; border: 1px solid var(--bcborders, #d7d5dd); border-radius: 10px; padding: 8px 10px; background: var(--bcbackground-1, #f2f1f4); color: inherit; }
input { width: 90px; }
select { flex: 1; }
.foot { display: flex; gap: 8px; justify-content: flex-end; }
.foot .off { margin-right: auto; }
`;

function openPicker(container?: Element | null) {
	const start = current ?? { value: 7, unit: "days" as Unit };
	const value = h("input", {
		type: "number",
		min: "1",
		max: String(MAX[start.unit]),
		value: String(start.value),
		"aria-label": "Length",
	});
	const unit = h(
		"select",
		{ "aria-label": "Unit" },
		...(Object.keys(MAX) as Unit[]).map((u) =>
			h("option", { value: u, selected: u === start.unit }, UNIT_LABEL[u][1]),
		),
	);
	const clampValue = () => {
		const max = MAX[unit.value as Unit];
		value.max = String(max);
		const n = Math.round(Number(value.value));
		value.value = String(
			Math.min(max, Math.max(1, Number.isFinite(n) ? n : 1)),
		);
	};
	unit.addEventListener("change", clampValue);
	value.addEventListener("change", clampValue);

	const layer = mountLayer(CSS, container);
	const close = () => {
		layer.remove();
		window.removeEventListener("keydown", onKey, true);
	};
	const onKey = (e: KeyboardEvent) => {
		if (e.key === "Escape") {
			e.stopPropagation();
			close();
		} else if (e.key === "Enter") save();
	};
	const save = () => {
		clampValue();
		close();
		apply({ value: Number(value.value), unit: unit.value as Unit });
	};
	window.addEventListener("keydown", onKey, true);

	const scrim = h(
		"div",
		{ class: "scrim" },
		h(
			"div",
			{
				class: "panel",
				role: "dialog",
				"aria-modal": "true",
				"aria-label": "Custom range",
			},
			h("h2", {}, "Custom range"),
			h(
				"p",
				{},
				"Show tasks for a rolling window starting today. The arrows move it by the same length.",
			),
			h("div", { class: "row" }, value, unit),
			h(
				"div",
				{ class: "foot" },
				current &&
					h(
						"button",
						{
							class: "btn off",
							on: {
								click: () => {
									close();
									apply(null);
								},
							},
						},
						"Turn off",
					),
				h("button", { class: "btn", on: { click: close } }, "Cancel"),
				h("button", { class: "btn primary", on: { click: save } }, "Save"),
			),
		),
	);
	scrim.addEventListener("pointerdown", (e) => {
		if (e.target === scrim) close();
	});
	layer.root.append(scrim);
	value.focus();
	value.select();
}

onFeature<{ feature: string; setStartDate: (d: Date) => void }>(
	"todo_context",
	(d) => {
		setStartDate = d.setStartDate;
	},
);

onFeature<{
	feature: string;
	action: "pick" | "clear";
	container?: Element | null;
}>("todo_custom_range", (d) => {
	if (d.action === "pick") openPicker(d.container);
	else if (current) apply(null);
});
