# BetterCampus for Firefox (stripped)

An unofficial Firefox port of the [BetterCampus (prev. BetterCanvas)](https://chromewebstore.google.com/detail/cndibmoanboadcifjkjbdpjgfedanolh) Chrome extension, with its cloud, AI, account and upsell layers removed. The classic local features stay: dark mode, themes and the community theme browser, custom fonts, dashboard card grades/tasks/colors, the To-Do list, the GPA calculator, the Quick Note and Grades widgets, the sidebar and search bar.

## What's removed

`patches.json` holds 85 string patches against the minified bundle, plus 5 anchors that patch nothing (group `subframe`, below). Each entry has a `group` and a `why`.

| Group | Removes |
| --- | --- |
| `menu` | The remote ext.bettercampus.com app shell (hub, planner, grades, notes, study, locker, explore, login). The menu opens the extension's built-in local settings panel instead. |
| `promos` | Campaign popups, the welcome tab and referral capture on install, the what's-new tour, the uninstall survey URL, upgrade/paywall dialogs, the rate-us prompt, and the sidebar "Join free / Upgrade / Refer a friend" footer. |
| `page` | Canvas-page injections: the Planner/Notes/Grades/Study sidebar items, the AI syllabus CTA, the calendar Sync buttons, the "+ Create" card button, AI reminder prompts, cloud grade links, and the remote dashboard widgets. |
| `cleanup` | Leftovers found by rendering the build: cloud/AI widgets in the Widgets catalog, the Calendar Sync and Streaks settings, the AI Transparency row, the "Create free account" theme wall, the GPA history dialog's Upload Transcript tab (a cloud AI import), settings text that still mentioned calendar sync or a BetterCampus account, and background settings-sync and streak requests. |
| `removals` | Fun widgets (the floating music/timer/dino/quote/breathe widgets and the Doge dashboard widget), file annotations (the PDF annotation layer in the Canvas file viewer and its settings), and auto-rotating themes (the header button and the Appearance section). |
| `bcx` | Hooks that hand some Pro-locked controls to our own implementations in `src/bcx/` (below). |
| `telemetry` | PostHog usage analytics, sent straight to `us.i.posthog.com` from the background script, the page content script and the file viewer, plus the startup call that links the anonymous analytics ID to an account. Each of these first asks BetterCampus's own analytics consent check, which now always answers no, whatever the stored `anonymous_usage_data` setting says. |
| `cloud` | Requests to `api.bettercampus.com` made without an account. Upstream's backend client sends them anyway, tagged with a persistent device ID: every To-Do edit (with the assignment title, course code, due date and status in plain text), class schedule edits (course name, code and meeting times) and To-Do lookups. Both copies of the client, in the page script and the background script, now answer as a signed-out request would, except for the public reads the community theme browser needs: theme lists, single themes, comments, slot limits and sticker palettes. |
| `perf` | Work repeated for no change in result. Each shadow-root UI BetterCampus mounts re-fetched the 218 KB `all.css` and regex-split it into document and shadow rules, a few milliseconds of work per mount, and a Canvas page mounts many. Both now happen once per page. |
| `subframe` | Nothing: these entries only pin the upstream code that `src/subframe.ts` mirrors (see [Load time](#load-time)), so the build fails if it changes. |

The manifest also drops `googlecalendar.js`, `outlookcalendar.js` and `stripe.js`, which only served calendar sync and checkout. It also drops `extension-bridge.js`, which let pages on ext.bettercampus.com read the extension's settings and IndexedDB, change settings, and act in your Canvas tab. The build also leaves out 5.9 MB of packaged files that nothing references: large illustrations, the referral avatars, the grades onboarding videos, a Chrome Web Store screenshot, old icons and a dark-mode stylesheet the bundle doesn't load.

## Our own versions of Pro features (`src/bcx/`)

These are written from scratch rather than unlocked. They have their own code and UI. They save only through paths free users already have, and they never run BetterCampus's gated code or write its gated settings. Their locked controls call `globalThis.__bcx(...)`. That function lives on the content-script global, so web pages can't trigger it.

| Feature | What ours does |
| --- | --- |
| Card / sidebar / background image editing | Our editor (`cardImage.ts`) replaces their cropper. You pan to crop and can zoom, rotate, flip, and pick from our own filter presets with an intensity slider. Edits are baked into a WebP that is saved through the same setter as their free "paste an image URL" path. Animated images can be kept unedited. |
| Agenda day navigation | When their ←/→ moves off today, our day view (`agenda.ts`) builds that day from the free data their today view uses: class schedule, cached Canvas to-dos, overrides, planned sessions and events. It renders inside their widget with their own list component. "Jump to today" hands back to their view. A calendar button in the To-Do List header opens the Agenda, since their remote hub was its only launcher. |
| Custom To-Do timeframe | "Custom" in any timeframe dropdown (dashboard header, Settings → To-Do, Settings → Dashboard) opens our picker (`todoRange.ts`). It sets a rolling window of 1–30 days, 1–25 weeks or 1–6 months starting today. The range is stored in our own `bcx_todo_range` key. While it's active, the list asks our module for its date window and arrow step; their free list pipeline then loads and groups that window, and the header shows e.g. "10 Days". Picking Day/Week/Month, or "Turn off" in the picker, ends it. |
| Focus-session time of day | In a focus session's "Planned at" popover, our column (`sessionTime.ts`) replaces their Pro time picker. It offers All-Day, four time-of-day presets (Morning 10:00, Afternoon 2:00, Evening 6:00, Night 10:00, the same slots their auto-planner uses) and an exact time field. The time is saved per session in our own `bcx_session_times` key; their saved date stays on the free All-Day value. The session row then reads e.g. "Oct 20 at 6:00pm", and moving the session to another day keeps its time. Times show only in the session editor: the Agenda doesn't list focus sessions. |

Our dialogs use the same theme variables as BetterCampus's own UI, so they follow dark mode and custom themes. When opened from the settings panel, they mount in the panel's portal. The page portal can't be used because the panel scales the page down into its preview.

`bun port-to-firefox.ts` compiles `src/bcx/main.ts` into a minified `content-scripts/bcx.js` and loads it after `all.js`. `bun run check` type-checks and lints it.

## Dark mode on Canvas's React pages (`src/bcx/darkTheme.ts`)

BetterCampus's dark mode is a fixed list of Canvas selectors. Canvas's newer React pages use InstUI components instead, including discussions, New Quizzes and the newer assignment views. Their class names are hashed emotion classes (`.css-1x2y3z-view`) inserted at runtime, so those panels stayed white while their text turned light. Pasted post formatting and @mentions also disappeared or glared.

`darkTheme.ts` runs whenever their `#darkcss` sheet is active, which covers dark mode and themes but not Quiz Safe Mode. It does two things:

- **InstUI rules:** it reads each emotion rule as it arrives. It maps:
  - light backgrounds to `--bcbackground-0/1/2` by lightness;
  - light neutral borders to `--bcborders`;
  - dark neutral text to `--bctext-0/2`;
  - link colors to `--bclinks`.

  A theme color left on "Use Canvas default" falls back to the main slot, then to Canvas's own color. Toggle knobs and the color mixer's handles are skipped.
- **Pasted formatting in posts and quoted replies:**
  - White and gray "paper" backgrounds are dropped. So are pale tints the theme's text can't be read on.
  - Colored highlights keep their color, with dark text on brighter ones. Their sheet gives `#fbeeb8` highlights the page background as text color, which vanishes on light themes.
  - Darker highlights the theme's text can't be read on get light text.
  - Text colors that vanish against what they sit on fall back to the theme's text color, and so does Canvas's purple @mention.
  - Elements that bring their own readable color pair, like white-on-black labels, are left alone.

## Settings backup (`src/bcx/backup.ts`, `src/options/`)

Firefox deletes all of an add-on's storage when the add-on is removed: on uninstall, and at every restart for a copy loaded from `about:debugging`. Installing a new build over the old one counts as an update and keeps everything. Removing it first used to reset every setting.

- **Automatic copy.** On your Canvas site (Other → Your Canvas URL, detected automatically), `bcx.js` keeps a copy of your settings in that site's localStorage, which Firefox leaves alone when the add-on goes. The copy is updated two seconds after a change and checked once per page load. After a fresh install, the first visit to that site writes the copy back, reloads the page, and shows a notice with the copy's date. An install that already has settings never restores over them, so the copy can't undo newer changes or a Reset All Preferences.
- **What's in it.** All of BetterCampus's settings and local data: theme, colors, cards, sidebar, To-Do options and edits, the GPA calculator, the Quick Note, and our own `bcx_*` keys. It leaves out caches of remote data, the device and analytics IDs, account fields and upstream's install bookkeeping (`src/bcx/settings.ts`). If a copy won't fit in the site's 5 MB quota, it drops edited images (embedded `data:` URLs) and keeps everything else.
- **Who can read it.** Canvas's own page scripts can read the site's localStorage, the same as the theme cache BetterCampus already keeps there.
- **Backup file.** `about:addons` → BetterCampus → Preferences opens a page that shows when the automatic copy last ran, and exports your settings to a JSON file or imports them from one. Use it to move to another computer or profile, or before clearing Canvas's site data, which deletes the automatic copy. Firefox's "Delete cookies and site data when Firefox is closed" setting does that at every restart unless Canvas is listed as an exception.

## Load time

BetterCampus injects `all.js` into every page you visit, so its cost lands on all your browsing, not just Canvas. The build cuts that cost in four ways. None of them changes a feature; the one thing that stops working is a hidden developer timing tool (see Profiler).

- **Subframes.** `all.js` ran in every frame of every page, including ads, embeds and video players. Before its `main()` returned for a subframe, it initialized all of BetterCampus: React, its API schemas, the Tailwind class merger and every other module. In the measurements below that came to about 300 ms per frame, and in a subframe all of it served two small jobs. It registered the Figtree font, which the Canvas file viewer's UI uses, and, when the LMS frames one of its own pages, it painted a cached anti-flicker style for 1.5 s. `all.js` and `bcx.js` now load in the top frame only, and a 3 KB `subframe.js` (`src/subframe.ts`) does those two jobs in every frame. The `subframe` anchors in `patches.json` pin the upstream code it mirrors.
- **Profiler.** BetterCampus wraps ~9k functions per bundle in a local profiler (`const e=at("id");try{…}catch(n){throw ot(e),n}finally{st(e)}`). Its spans only record while a hidden debug mode is on, but every call paid for them anyway. The build unwraps them all and drops the span ids nothing reads, so the hidden Debug tab no longer has anything to time.
- **Dead code.** Terser then runs a pass over every bundle that only removes or folds code: no mangling or inlining. It drops what the patches leave unreachable and whatever only that code used, such as the file viewer's annotation toolbar and the campaign card's 842 KB inline image. `all.js` goes from 5.2 to 3.7 MiB, `background.js` from 429 to 364 KiB and `viewer.js` from 700 to 638 KiB.
- **Repeated work.** The `perf` patches above. `bcx.js` is minified, only reads the large `overrides` object when saved session times need checking against it, and the dark-mode fix no longer scans stylesheets while dark mode and themes are off.

Measured in headless Firefox 158 on a slow virtual machine, so the ratios matter more than the absolute times:

| | Before | After | No extension |
| --- | --- | --- | --- |
| Page with 10 iframes, load | 3,970 ms | 244 ms | 73 ms |
| Mock Canvas dashboard, BetterCampus UI mounted | 338 ms | 199 ms | |
| Mock Canvas dashboard, DOMContentLoaded | 170 ms | 142 ms | 15 ms |
| Plain page, DOMContentLoaded | 163 ms | 158 ms | 19 ms |
| `.xpi` size | 11.0 MiB | 4.7 MiB | |

What remains is `all.js` initializing in each top-level page, which its LMS detection and site-wide features (custom cursors, the shared components UI) need.

## Build

```sh
bun install
bun port-to-firefox.ts [path/to/chrome.zip]
```

This repo doesn't include BetterCampus itself. Supply the extension's Chrome Web Store package as a `.zip`; the patches target version 9.8.15. The script uses the `*Chrome*.zip` in this directory unless you pass a path. It outputs `firefox/` (unpacked) and `dist/bettercampus-firefox-<version>.xpi`. It also does the Firefox manifest conversion: `background.scripts`, `browser_specific_settings.gecko`, and removing `update_url` and `_metadata/`.

Patch anchors are minified code, so a new upstream version will likely break some of them. The script stops and names each patch whose anchor no longer matches exactly once; those need re-deriving against the new bundle. A `subframe` anchor that stops matching means upstream changed what `all.js` does in subframes: update `src/subframe.ts` to match before the anchor. Prefer anchors on the stable 8-character `at("…")` instrumentation ids and string literals.

AMO's linter refuses to parse any JS file of 5 MiB or more, which blocks signing, and the patched `all.js` is 5.19 MiB. The profiler and dead-code passes above bring it to 3.7 MiB, and the build fails if any file ends up over the limit. Those passes take most of the build's 20 seconds. `bun run lint:ext` runs the same linter as AMO.

## Install

Release Firefox only installs add-ons signed by Mozilla. Signing it as an **unlisted** (self-distributed) add-on is free and automated; it isn't published on AMO.

1. Sign in at [addons.mozilla.org](https://addons.mozilla.org/developers/). AMO requires two-factor authentication on the account.
2. Sign the build using one of these:
   - **Web upload:** [Submit a New Add-on](https://addons.mozilla.org/developers/addon/submit/distribution), choose **On your own**, and upload `dist/bettercampus-firefox-<version>.xpi`. When validation finishes, download the signed file from the version's page.
   - **CLI:** create API credentials at [Manage API Keys](https://addons.mozilla.org/developers/addon/api/key/), then put them in `.env` (git-ignored):
     ```sh
     WEB_EXT_API_KEY=user:12345:67
     WEB_EXT_API_SECRET=…
     ```
     Run `bun --env-file=.env run sign`. It uploads `firefox/`, waits for signing, and saves the signed `.xpi` in `dist/`.
   - **CLI with 1Password:** save the keys in 1Password as an **API Credential** item: the JWT issuer goes in **username** and the JWT secret in **credential**. Point the two references in `amo.env` at that item; they default to `op://Private/AMO/…`, and each field's **Copy Secret Reference** gives the exact path. Turn on 1Password → Settings → Developer → **Integrate with 1Password CLI**, then run `bun run sign:1p`. `op run` resolves the references and passes the keys only to the signing process.
3. In Firefox, open `about:addons` → ⚙ → **Install Add-on From File…** and pick the signed `.xpi`.

AMO signs each version number once per add-on ID. To sign a rebuild of the same upstream version, build with a fourth version part: `BUILD=2 bun run build` makes `9.8.15.2`. Installing a newer signed build replaces the old one and keeps your settings, since the add-on ID stays the same. If you remove the old one first, opening Canvas brings them back from the [settings backup](#settings-backup-srcbcxbackupts-srcoptions).

Unlisted add-ons can still be manually reviewed by Mozilla at any time, and reviewers may ask for unminified source, which this port doesn't have.

To test without signing, open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on…**, and pick `firefox/manifest.json`. That copy and its storage are removed when Firefox restarts; after loading it again, opening Canvas restores your settings from the backup. Developer Edition, Nightly and ESR can also install the unsigned `.xpi` after setting `xpinstall.signatures.required` to `false` in `about:config`.

## Known limitations

- The toolbar button does nothing on non-Canvas tabs, because it used to open the remote setup page. Visit your Canvas site and it is detected automatically, or set the URL under Other → Your Canvas URL.
- Free plans still get one focus session per assignment ("Plan another focus session" keeps its Pro crown).
- Planned-session reminders are still Pro-only, so a session's time doesn't trigger a notification.
- The browser APIs differ from Chrome in a few spots: there is no eyedropper in the color picker, and the rate link still points to the Chrome Web Store.
