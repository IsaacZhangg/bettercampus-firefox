// Day navigation for the Agenda widget. Their widget only ever shows today
// for free users; when the arrows move off today we draw that day ourselves
// inside the widget (their classes, so it looks the same) from the same free
// data their today view uses, and hand back to their view on "today".

import { onFeature } from "./registry";

type Course = { code?: string; default?: string; color?: string };
type ScheduleEntry = { course: string; start: number; end: number };
type CalEvent = {
	title: string;
	startDate: Date;
	duration?: number;
	isAllDay?: boolean;
	calendarColor?: string;
	location?: string;
};
type Todo = {
	id: string;
	title: string;
	course?: string | number;
	due?: string;
	status?: string;
	duration?: number;
};
type Planned = { plannedAt?: string; duration?: number; title?: string };

export type AgendaItem = {
	title: string;
	courseCode?: string;
	courseColor: string;
	timedEvent: { start: Date; end: Date } | null;
	dueTime: Date | null;
	type: "class" | "google" | "planned" | "due";
	id?: string;
	status?: string;
	location?: string;
	duration?: number;
};

type Ctx = {
	courseData: Record<string, Course>;
	schedule?: Record<number, ScheduleEntry[]>;
	visibleCourseIds: string[];
	overrides: Record<string, Partial<Todo>>;
	planned: Record<string, Planned>;
	events: CalEvent[];
	timeFormat: string;
	loadRange: (start: Date, end: Date) => Promise<unknown>;
	todoCache: () => { todo?: Todo[] } | undefined;
	defaults: Partial<Todo>;
	renderList: (el: HTMLElement, items: AgendaItem[]) => { unmount(): void };
};

const DAY = 86_400_000;
const startOfDay = (d: Date) =>
	new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) =>
	new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const dayDiff = (a: Date, b: Date) =>
	Math.round((startOfDay(a).getTime() - startOfDay(b).getTime()) / DAY);
const atMinutes = (d: Date, minutes: number) =>
	new Date(
		d.getFullYear(),
		d.getMonth(),
		d.getDate(),
		Math.floor(minutes / 60),
		minutes % 60,
	);
const plusMinutes = (d: Date, minutes: number) =>
	new Date(d.getTime() + minutes * 60_000);

function courseLabel(course: Course | undefined) {
	return {
		courseCode: course?.code ? course.code : course?.default,
		courseColor: course?.color ? course.color : "gray",
	};
}

export function buildDay(ctx: Ctx, date: Date): AgendaItem[] {
	const items: AgendaItem[] = [];
	const visible = new Set(ctx.visibleCourseIds.map(String));

	for (const entry of ctx.schedule?.[date.getDay()] ?? []) {
		if (!visible.has(String(entry.course))) continue;
		const course = ctx.courseData[entry.course];
		items.push({
			title: course?.code || course?.default || "Class",
			...courseLabel(course),
			timedEvent: {
				start: atMinutes(date, entry.start),
				end: atMinutes(date, entry.end),
			},
			dueTime: null,
			type: "class",
		});
	}

	for (const ev of ctx.events) {
		if (ev.isAllDay || dayDiff(new Date(ev.startDate), date) !== 0) continue;
		const start = new Date(ev.startDate);
		items.push({
			title: ev.title,
			courseCode: "Calendar",
			courseColor: ev.calendarColor || "#4285f4",
			timedEvent: { start, end: plusMinutes(start, ev.duration || 0) },
			dueTime: null,
			type: "google",
			location: ev.location,
		});
	}

	for (const raw of ctx.todoCache()?.todo ?? []) {
		const plan = ctx.planned[raw.id];
		const item = {
			...ctx.defaults,
			...raw,
			...plan,
			...ctx.overrides[raw.id],
		} as Todo;
		if (item.course != null && !visible.has(String(item.course))) continue;
		const label = courseLabel(
			item.course != null ? ctx.courseData[item.course] : undefined,
		);
		if (item.due && dayDiff(new Date(item.due), date) === 0)
			items.push({
				title: item.title,
				...label,
				timedEvent: null,
				dueTime: new Date(item.due),
				type: "due",
				id: item.id,
				status: item.status,
			});
		if (plan?.plannedAt && dayDiff(new Date(plan.plannedAt), date) === 0) {
			const start = new Date(plan.plannedAt);
			const duration = plan.duration || item.duration || 30;
			items.push({
				title: plan.title || item.title,
				...label,
				timedEvent: { start, end: plusMinutes(start, duration) },
				dueTime: null,
				type: "planned",
				duration,
			});
		}
	}

	const when = (i: AgendaItem) =>
		(i.timedEvent?.start ?? i.dueTime ?? new Date("2099-12-31")).getTime();
	return items.sort((a, b) => when(a) - when(b));
}

type Shape = [tag: string, attrs: Record<string, string>];
const ICONS = {
	calendar: [
		["rect", { x: "3", y: "4", width: "18", height: "18", rx: "2" }],
		["path", { d: "M16 2v4M8 2v4M3 10h18" }],
	],
	left: [["path", { d: "M19 12H5M12 19l-7-7 7-7" }]],
	right: [["path", { d: "M5 12h14M12 5l7 7-7 7" }]],
	clock: [
		["circle", { cx: "12", cy: "12", r: "10" }],
		["path", { d: "M12 6v6l4 2" }],
	],
	alert: [
		["circle", { cx: "12", cy: "12", r: "10" }],
		["path", { d: "M12 8v4M12 16h.01" }],
	],
} satisfies Record<string, Shape[]>;

const SVG_NS = "http://www.w3.org/2000/svg";

function svgEl(tag: string, attrs: Record<string, string>) {
	const node = document.createElementNS(SVG_NS, tag);
	for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
	return node;
}

function icon(name: keyof typeof ICONS, cls: string) {
	const svg = svgEl("svg", {
		viewBox: "0 0 24 24",
		fill: "none",
		stroke: "currentColor",
		"stroke-width": "2",
		"stroke-linecap": "round",
		"stroke-linejoin": "round",
		class: cls,
	});
	for (const [tag, attrs] of ICONS[name] as Shape[])
		svg.append(svgEl(tag, attrs));
	return svg;
}

function el(tag: string, cls: string, ...children: (Node | string)[]) {
	const node = document.createElement(tag);
	node.className = cls;
	node.append(...children);
	return node;
}

function relativeLabel(date: Date) {
	const d = dayDiff(date, new Date());
	if (d === 0) return "Today";
	if (d === 1) return "Tomorrow";
	if (d === -1) return "Yesterday";
	return d > 0 ? `In ${d} days` : `${-d} days ago`;
}

let ctx: Ctx | null = null;
let root: HTMLElement | null = null;
let view: {
	el: HTMLElement;
	date: Date;
	list: { unmount(): void } | null;
	timer: number;
	seq: number;
} | null = null;

function closeView() {
	if (!view) return;
	view.list?.unmount();
	clearInterval(view.timer);
	view.el.remove();
	view = null;
}

function showDay(date: Date) {
	if (!ctx || !root) return;
	if (dayDiff(date, new Date()) === 0) return closeView();
	if (!view) {
		root.style.position = "relative";
		const el = document.createElement("div");
		el.className =
			"p-4 pt-5 bg-theme-0 text-theme-0 flex flex-col gap-3 h-full overflow-auto";
		el.style.cssText = "position:absolute;inset:0;z-index:5";
		root.append(el);
		view = { el, date, list: null, timer: 0, seq: 0 };
	}
	view.date = startOfDay(date);
	render(view.date);
}

async function render(date: Date) {
	if (!view || !ctx) return;
	const v = view;
	const seq = ++v.seq;
	v.list?.unmount();
	v.list = null;
	clearInterval(v.timer);

	const navButton = (dir: "left" | "right") => {
		const b = el(
			"button",
			"p-1 hover:bg-theme-1 rounded transition-colors cursor-pointer relative",
			icon(dir, "h-4 w-4"),
		);
		b.setAttribute("aria-label", dir === "left" ? "Previous day" : "Next day");
		b.addEventListener("click", () =>
			showDay(addDays(v.date, dir === "left" ? -1 : 1)),
		);
		return b;
	};
	const today = el(
		"button",
		"text-xs text-theme-1 italic hover:text-theme-0 transition-colors cursor-pointer",
		"Jump to today",
	);
	today.addEventListener("click", closeView);

	const clockText = el("p", "", "");
	const tick = () => {
		// Closing their widget detaches ours with it; stop the clock and list.
		if (!v.el.isConnected) return closeView();
		clockText.textContent = new Date().toLocaleTimeString("en-US", {
			hour: ctx?.timeFormat.startsWith("HH") ? "2-digit" : "numeric",
			minute: "2-digit",
			hour12: !ctx?.timeFormat.startsWith("HH"),
		});
	};
	v.timer = window.setInterval(tick, 1000);
	tick();

	const counts = el("div", "flex items-center gap-2");
	const body = el(
		"div",
		"flex items-center justify-center py-8",
		el("div", "text-theme-1", "Loading schedule..."),
	);

	v.el.replaceChildren(
		el(
			"div",
			"flex items-center justify-between",
			el(
				"div",
				"flex items-center gap-2",
				icon("calendar", "h-5 w-5 text-theme-0"),
				el("h1", "text-lg text-theme-0 font-semibold", "Agenda"),
			),
			el(
				"div",
				"flex items-center justify-between gap-2",
				el("div", "flex items-center gap-2", today, navButton("left")),
				el(
					"div",
					"flex items-center gap-2",
					el("p", "text-sm", relativeLabel(date)),
				),
				navButton("right"),
			),
		),
		el(
			"div",
			"flex items-center justify-between text-sm",
			el(
				"div",
				"flex items-center gap-3",
				el(
					"p",
					"",
					date.toLocaleDateString("en-US", { month: "long", day: "numeric" }),
				),
				counts,
			),
			el("div", "flex items-center gap-2", icon("clock", "h-4 w-4"), clockText),
		),
		body,
	);

	try {
		await ctx.loadRange(date, addDays(date, 1));
	} catch (err) {
		console.error("[bcx] agenda: couldn't load", err);
	}
	if (seq !== v.seq || view !== v || !ctx) return;

	const items = buildDay(ctx, date);
	const scheduled = items.filter((i) => i.type !== "due").length;
	const count = (name: keyof typeof ICONS, n: number, label: string) => {
		const c = el(
			"div",
			"flex items-center gap-1 cursor-pointer",
			icon(name, "h-3 w-3 text-theme-1"),
			el("span", "text-xs text-theme-1", String(n)),
		);
		c.title = label;
		return c;
	};
	counts.replaceChildren(
		count("clock", scheduled, "Events"),
		count("alert", items.length - scheduled, "Planner"),
	);

	if (!items.length) {
		body.className =
			"flex flex-col items-center justify-center py-8 text-theme-1";
		body.replaceChildren(
			icon("calendar", "h-8 w-8 mb-2 opacity-50"),
			el("p", "text-sm", "No events or tasks scheduled for this day"),
		);
		return;
	}
	body.className = "";
	body.replaceChildren();
	v.list = ctx.renderList(body, items);
}

onFeature<{ feature: string; ctx: Ctx }>("agenda_context", (d) => {
	ctx = d.ctx;
});

onFeature<{ feature: string; el: HTMLElement }>("agenda_root", (d) => {
	if (d.el === root) return;
	// A fresh widget instance starts on today, like theirs.
	closeView();
	root = d.el;
});

onFeature<{ feature: string; target: Date }>("agenda_date_change", (d) => {
	showDay(new Date(d.target));
});

// Their remote hub was the only way to open the Agenda; give it a button in
// the dashboard To-Do List header, next to the title.
function addLauncher() {
	const shadow = document.querySelector("bettercampus-todo-list")?.shadowRoot;
	if (!shadow || shadow.querySelector("[data-bcx-agenda]")) return;
	const title = [...shadow.querySelectorAll("p")].find(
		(p) => p.textContent === "To-Do List",
	);
	if (!title?.parentElement) return;
	const button = el(
		"button",
		"p-1 hover:bg-theme-1 rounded transition-colors cursor-pointer text-theme-1 hover:text-theme-0",
		icon("calendar", "h-4 w-4"),
	);
	button.dataset.bcxAgenda = "";
	button.title = "Agenda";
	button.setAttribute("aria-label", "Open agenda");
	button.addEventListener("click", () =>
		window.dispatchEvent(
			new CustomEvent("bettercanvas:openWidget", {
				detail: { widgetType: "agenda" },
			}),
		),
	);
	title.parentElement.append(button);
}

if (window === window.top) {
	let tries = 0;
	const findList = setInterval(() => {
		const shadow = document.querySelector("bettercampus-todo-list")?.shadowRoot;
		if (!shadow && ++tries < 60) return;
		clearInterval(findList);
		if (!shadow) return;
		// Their React re-renders can drop our node; put it back when it does.
		new MutationObserver(addLauncher).observe(shadow, {
			childList: true,
			subtree: true,
		});
		addLauncher();
	}, 1000);
}
