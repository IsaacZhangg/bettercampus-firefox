// What a settings backup holds: BetterCampus's storage.local, minus caches of
// remote data, device and account identifiers, and per-install bookkeeping.
// Shared by the automatic copy on your Canvas site (backup.ts) and the
// export/import buttons on the add-on's options page (src/options/).

export const FORMAT = "bettercampus-firefox-settings";

export type Backup = {
	format: typeof FORMAT;
	savedAt: number;
	version: string;
	data: Record<string, unknown>;
};

// Our record of the automatic backup. Having one means this install's
// settings are already its own (made, imported or restored here), so the
// automatic copy is never put back over them. `origin` and `savedAt` say where
// and when the copy was last saved; `restored` is set from a restore until the
// page that did it reloads.
export const STATE_KEY = "bcx_backup";
export type BackupState = {
	origin?: string;
	savedAt?: number;
	restored?: number;
};

const SKIP = new Set([
	// Caches of remote or derived data, rebuilt on demand.
	"request_cache",
	"request_response_cache",
	"cached_theme_likes",
	"cached_friend_ids",
	"cached_streak_restores",
	"cached_planned_assignments",
	"cached_game_home",
	"study_notebooks_cache",
	"theme_sticker_palette",
	"announcements_config",
	"cached_ics_feed_count",
	"errors",
	// Server-pushed flags and the hidden debug mode.
	"feature_flags",
	"last_flag_refresh",
	"debug_mode_active",
	// Device and account identifiers (this build has no account).
	"device_id",
	"analytics_id",
	"encryption_key",
	"encryption_key_user_id",
	"auth",
	"auth_state",
	"auth_intent",
	"token",
	"id",
	// Per-install bookkeeping that upstream's install handler writes itself.
	"__bc_storage_migrated_v1",
	"migration_apply_error_sync",
	STATE_KEY,
]);
const SKIP_PREFIXES = [
	"campaign_",
	"interval_",
	"migration_error_",
	"bettercampus-wxt-query-cache-v1:",
];

export const isSetting = (key: string) =>
	!SKIP.has(key) && !SKIP_PREFIXES.some((p) => key.startsWith(p));

export const pick = (all: Record<string, unknown>) =>
	Object.fromEntries(
		Object.entries(all)
			.filter(([key]) => isSetting(key))
			.sort(([a], [b]) => (a < b ? -1 : 1)),
	);

// `all` is the whole of storage.local.
export const toBackup = (all: Record<string, unknown>): Backup => ({
	format: FORMAT,
	savedAt: Date.now(),
	version: browser.runtime.getManifest().version,
	data: pick(all),
});

export function parse(text: string | null): Backup | null {
	if (!text) return null;
	try {
		const b = JSON.parse(text);
		const ok =
			b?.format === FORMAT &&
			Number.isFinite(b.savedAt) &&
			typeof b.data === "object" &&
			b.data !== null &&
			!Array.isArray(b.data);
		return ok ? b : null;
	} catch {
		return null;
	}
}

// Whether `origin` is one of the Canvas sites in the user's settings, matched
// the way BetterCampus matches them (the stored value is usually an origin,
// but the settings field accepts anything).
export function isCanvasOrigin(customDomain: unknown, origin: string) {
	const domains = Array.isArray(customDomain) ? customDomain : [customDomain];
	return domains.some(
		(d) =>
			typeof d === "string" &&
			d.trim() !== "" &&
			origin.includes(d.trim().replace(/\/+$/, "")),
	);
}
