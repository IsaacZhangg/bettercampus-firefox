// Firefox deletes an add-on's storage when the add-on is removed: on
// uninstall, and at every restart for one loaded from about:debugging. So
// reinstalling a build used to reset every setting. This keeps a copy of the
// settings (see settings.ts) in your Canvas site's localStorage, which
// outlives the add-on, and puts it back the first time a fresh install opens
// that site.
//
// Canvas's own scripts can read that copy, as they can the theme cache
// BetterCampus already keeps there (`_bettercampus_theme_cache`). It never
// holds account or device identifiers. The options page saves the same
// settings to a file instead.

import {
	type Backup,
	type BackupState,
	isCanvasOrigin,
	isSetting,
	parse,
	pick,
	STATE_KEY,
	toBackup,
} from "./settings";
import { toast } from "./ui";

const PAGE_KEY = "bettercampus_firefox_settings";
// How long after a change the backup runs, so that a burst of changes (a
// slider, the theme editor) makes one write. Later changes don't push it
// back: BetterCampus also writes state of its own every few seconds.
const DELAY = 2000;
// Each Canvas page checks the backup once, after it has loaded.
const FIRST_CHECK = 5000;
// Edited images are data: URLs, and only they can push a backup past the
// site's 5 MB localStorage quota. A backup without them keeps every setting.
const BIG_STRING = 100_000;

const readPage = () => {
	try {
		return parse(localStorage.getItem(PAGE_KEY));
	} catch {
		return null; // Storage is blocked for this site.
	}
};

function withoutImages(value: unknown): unknown {
	if (typeof value === "string")
		return value.length > BIG_STRING && value.includes("data:") ? "" : value;
	if (Array.isArray(value)) return value.map(withoutImages);
	if (value && typeof value === "object")
		return Object.fromEntries(
			Object.entries(value).map(([k, v]) => [k, withoutImages(v)]),
		);
	return value;
}

function writePage(backup: Backup) {
	try {
		localStorage.setItem(PAGE_KEY, JSON.stringify(backup));
		return true;
	} catch {}
	try {
		const data = withoutImages(backup.data);
		localStorage.setItem(PAGE_KEY, JSON.stringify({ ...backup, data }));
		return true;
	} catch (err) {
		console.warn("[bcx] couldn't save the settings backup:", err);
		return false;
	}
}

// Upstream's install handler writes every default in the same
// storage.local.set that adds `new_install`. A restore that lands first gets
// overwritten. That write normally finished long ago; it can still be running
// when the add-on is installed with a Canvas tab already open. It takes well
// under a second, so give up waiting after INSTALL_WAIT in case a later
// upstream version stops setting `new_install`.
const INSTALL_WAIT = 10_000;
function installSettled() {
	return new Promise<void>((resolve) => {
		const done = () => {
			clearTimeout(timeout);
			browser.storage.onChanged.removeListener(listen);
			resolve();
		};
		const timeout = setTimeout(done, INSTALL_WAIT);
		const listen = (
			changes: Record<string, browser.storage.StorageChange>,
			area: string,
		) => {
			if (area === "local" && "new_install" in changes) done();
		};
		browser.storage.onChanged.addListener(listen);
		browser.storage.local.get("new_install").then((s) => {
			if ("new_install" in s) done();
		});
	});
}

const date = (ms: number) =>
	new Date(ms).toLocaleString(undefined, {
		dateStyle: "medium",
		timeStyle: "short",
	});

let onCanvas = false;
let restoring = false;

async function init() {
	const stored = await browser.storage.local.get([STATE_KEY, "custom_domain"]);
	onCanvas = isCanvasOrigin(stored.custom_domain, location.origin);
	const state: BackupState | undefined = stored[STATE_KEY];
	if (state) {
		if (state.restored && state.origin === location.origin) {
			const { restored, ...rest } = state;
			await browser.storage.local.set({ [STATE_KEY]: rest });
			toast(
				`BetterCampus settings restored from your backup of ${date(restored)}.`,
			);
		}
		return;
	}
	// No record of a backup: a fresh install, or the first run of a build that
	// makes them. Restore only into the first; a backup here means it's that.
	const saved = readPage();
	if (!saved) return;
	restoring = true;
	await installSettled();
	const next: BackupState = {
		origin: location.origin,
		savedAt: saved.savedAt,
		restored: saved.savedAt,
	};
	await browser.storage.local.set({ ...pick(saved.data), [STATE_KEY]: next });
	location.reload();
}

const ready = init().catch((err) =>
	console.warn("[bcx] settings restore failed:", err),
);

let timer: ReturnType<typeof setTimeout> | undefined;
let lastData: string | undefined;

async function backUp() {
	await ready;
	if (restoring || !onCanvas) return;
	const all = await browser.storage.local.get(null);
	const backup = toBackup(all);
	const data = JSON.stringify(backup.data);
	lastData ??= JSON.stringify(readPage()?.data ?? null);
	if (data === lastData && all[STATE_KEY]?.savedAt) return;
	if (!writePage(backup)) return;
	lastData = data;
	const state: BackupState = {
		origin: location.origin,
		savedAt: backup.savedAt,
	};
	await browser.storage.local.set({ [STATE_KEY]: state });
}

function schedule(delay = DELAY) {
	if (timer !== undefined) return;
	timer = setTimeout(() => {
		timer = undefined;
		backUp().catch((err) => console.warn("[bcx] settings backup failed:", err));
	}, delay);
}

browser.storage.onChanged.addListener((changes, area) => {
	if (area !== "local") return;
	if (changes.custom_domain)
		onCanvas = isCanvasOrigin(changes.custom_domain.newValue, location.origin);
	if (onCanvas && Object.keys(changes).some(isSetting)) schedule();
});

ready.then(() => {
	if (onCanvas) schedule(FIRST_CHECK);
});
