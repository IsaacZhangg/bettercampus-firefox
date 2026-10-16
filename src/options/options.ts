// The add-on's options page (about:addons → BetterCampus → Preferences): when
// the automatic backup last ran, and settings export/import as a file.

import {
	type Backup,
	type BackupState,
	isCanvasOrigin,
	parse,
	pick,
	STATE_KEY,
	toBackup,
} from "../bcx/settings";

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const status = $("status");
const confirmBox = $("confirm");
const fileInput = $("file") as HTMLInputElement;

const date = (ms: number) =>
	new Date(ms).toLocaleString(undefined, {
		dateStyle: "medium",
		timeStyle: "short",
	});
const day = (ms: number) => {
	const d = new Date(ms);
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const originOf = (url: string) => {
	try {
		return new URL(url).origin;
	} catch {
		return "";
	}
};

async function showAuto() {
	const stored = await browser.storage.local.get(STATE_KEY);
	const state: BackupState | undefined = stored[STATE_KEY];
	$("auto").textContent =
		state?.origin && state.savedAt
			? `Last saved ${date(state.savedAt)} on ${new URL(state.origin).host}.`
			: "Not saved yet. It's saved a few seconds after you open your Canvas site.";
}

$("export").addEventListener("click", async () => {
	const backup = toBackup(await browser.storage.local.get(null));
	const blob = new Blob([JSON.stringify(backup, null, 2)], {
		type: "application/json",
	});
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = `bettercampus-settings-${day(backup.savedAt)}.json`;
	link.click();
	setTimeout(() => URL.revokeObjectURL(url), 60_000);
	status.textContent =
		"Exported. The file also holds your Quick Note and to-do data, so keep it private.";
});

let pending: Backup | null = null;

$("import").addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", async () => {
	const file = fileInput.files?.[0];
	fileInput.value = "";
	if (!file) return;
	pending = parse(await file.text());
	confirmBox.hidden = !pending;
	status.textContent = pending
		? ""
		: "That file isn't a BetterCampus settings export.";
	if (pending)
		$("confirm-text").textContent =
			`Replace your current settings with the ones exported ${date(pending.savedAt)}?`;
});

$("cancel").addEventListener("click", () => {
	pending = null;
	confirmBox.hidden = true;
});

$("replace").addEventListener("click", async () => {
	if (!pending) return;
	const data = pick(pending.data);
	pending = null;
	confirmBox.hidden = true;
	// Having a backup record keeps the automatic copy, which may be older,
	// from being restored over the import after a fresh install.
	const { [STATE_KEY]: state = {} } =
		await browser.storage.local.get(STATE_KEY);
	await browser.storage.local.set({ ...data, [STATE_KEY]: state });
	// Not every setting applies live, so reload the Canvas tabs.
	const { custom_domain } = await browser.storage.local.get("custom_domain");
	const tabs = (await browser.tabs.query({})).flatMap((t) =>
		t.id !== undefined &&
		t.url &&
		isCanvasOrigin(custom_domain, originOf(t.url))
			? [t.id]
			: [],
	);
	await Promise.all(tabs.map((id) => browser.tabs.reload(id)));
	status.textContent = tabs.length
		? "Settings imported. Your open Canvas tabs were reloaded."
		: "Settings imported.";
});

browser.storage.onChanged.addListener((changes, area) => {
	if (area === "local" && STATE_KEY in changes) showAuto();
});
showAuto();
