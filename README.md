# BetterCampus for Firefox (stripped)

An unofficial Firefox port of the [BetterCampus (prev. BetterCanvas)](https://chromewebstore.google.com/detail/cndibmoanboadcifjkjbdpjgfedanolh) Chrome extension, with its cloud, AI, account and upsell layers removed. The classic local features stay: dark mode, themes and the community theme browser, custom fonts, dashboard card grades/tasks/colors, the To-Do list, the GPA calculator, the Quick Note and Grades widgets, the sidebar and search bar.

## What's removed

`patches.json` holds 98 string patches against the minified bundle. Each entry has a `group` and a `why`.

| Group | Removes |
| --- | --- |
| `menu` | The remote ext.bettercampus.com app shell (hub, planner, grades, notes, study, locker, explore, login). The menu opens the extension's built-in local settings panel instead. |
| `promos` | Campaign popups, the welcome tab and referral capture on install, the what's-new tour, the uninstall survey URL, upgrade/paywall dialogs, the rate-us prompt, and the sidebar "Join free / Upgrade / Refer a friend" footer. |
| `page` | Canvas-page injections: the Planner/Notes/Grades/Study sidebar items, the AI syllabus CTA, the calendar Sync buttons, the "+ Create" card button, AI reminder prompts, cloud grade links, and the remote dashboard widgets. |
| `cleanup` | Leftovers found by rendering the build: cloud/AI widgets in the Widgets catalog, the Calendar Sync and Streaks settings, the AI Transparency row, the "Create free account" theme wall, the GPA history dialog's Upload Transcript tab (a cloud AI import), settings text that still mentioned calendar sync or a BetterCampus account, and background settings-sync and streak requests. |
| `removals` | Fun widgets (the floating music/timer/dino/quote/breathe widgets and the Doge dashboard widget), file annotations (the PDF annotation layer in the Canvas file viewer, its tooltips overlay and its settings), and auto-rotating themes (the header button and the Appearance section). |
| `bcx` | Hooks that hand some Pro-locked controls to our own implementations in `src/bcx/` (below). |
| `telemetry` | PostHog usage analytics, sent straight to `us.i.posthog.com` from the background script, the page content script and the file viewer, plus the startup call that links the anonymous analytics ID to an account. Each of these first asks BetterCampus's own analytics consent check, which now always answers no, whatever the stored `anonymous_usage_data` setting says. |
| `cloud` | Requests to `api.bettercampus.com` made without an account. Upstream's backend client sends them anyway, tagged with a persistent device ID: every To-Do edit (with the assignment title, course code, due date and status in plain text), class schedule edits (course name, code and meeting times) and To-Do lookups. Both copies of the client, in the page script and the background script, now answer as a signed-out request would, except for the public reads the community theme browser needs: theme lists, single themes, comments, slot limits and sticker palettes. |
| `perf` | Work repeated for no change in result. Each shadow-root UI BetterCampus mounts re-fetched the 218 KB `all.css` and regex-split it into document and shadow rules, a few milliseconds of work per mount, and a Canvas page mounts many. Both now happen once per page. |
| `fixes` | Upstream behavior that ignored your settings. The sidebar's course list showed each course's code even after you renamed the course with the card's Edit button; it now shows the new name, and courses you haven't renamed still show their code. Turning on Settings → Sidebar → Hide BetterCampus Logo left the switch off and opened a guide (with a Chrome screenshot) asking you to click the BetterCampus toolbar icon; only that click hid the sidebar's BetterCampus button, and closing the guide cancelled it. The switch now hides and shows the button directly. The toolbar button on a Canvas tab and the search bar's "Open BetterCampus" still open the menu. Dark mode with a light theme used a muddy palette; it now gets a real dark one (see [Dark mode for light themes](#dark-mode-for-light-themes-srcbcxdarkpresetts)). Dark mode's default text, which BetterCampus's own panels also use, was near white (`#f5f5f5`); it is now `#dedede`. |

The manifest also drops `googlecalendar.js`, `outlookcalendar.js` and `stripe.js`, which only served calendar sync and checkout. It also drops `extension-bridge.js`, which let pages on ext.bettercampus.com read the extension's settings and IndexedDB, change settings, and act in your Canvas tab, and `app-bridge.js` (new in 9.9.1), which relays sign-in, sign-out, sign-in codes and calendar connection from app.bettercampus.com to the extension. The build also leaves out 5.9 MB of packaged files that nothing references: large illustrations, the referral avatars, the grades onboarding videos, a Chrome Web Store screenshot, old icons and a dark-mode stylesheet the bundle doesn't load.

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

## Dark mode for light themes (`src/bcx/darkPreset.ts`)

A theme comes with one palette, light or dark. Applying a light theme also makes the palette dark mode uses, but upstream made it by taking 40% off each color's lightness and graying it. With a cream theme like cozysnoopy, the page turned mid khaki with near-black text and links, and the dark-brown sidebar got lighter, under pure white text. The settings panel's frame turned khaki too, around its dark-gray settings.

A `fixes` patch now has upstream's palette function ask `darkPreset.ts` for that palette. It works in OKLCH, slot by slot:

- **Backgrounds** become dark surfaces in their own hue. The page sits at 23% lightness. The light theme's steps are inverted: a slot darker than the page in light mode is lighter than it in dark mode, the way raised surfaces are.
- **Text** becomes an off-white at 88% lightness, never pure white. Near-black ink takes the page's tint (cream for cozysnoopy), and colored text keeps a hint of its own hue. Secondary text keeps its distance from the main text.
- **Links** keep their hue and get light enough to read (6:1 on the page).
- **The sidebar** sits a little darker than the page. Its text is off-white too. Gradients and image overlays keep their alpha.

Dark themes and light mode are unchanged. A light theme applied with an older build still has upstream's palette stored. On the next Canvas page load, `darkPreset.ts` swaps in the new one if the stored palette is still exactly what upstream generated. If you've edited it, it is left as is; apply the theme again to get the new one.

Course titles on dashboard cards take the course's color. On a dark card, a navy course was nearly invisible. In dark mode, titles under 4.5:1 now get lighter in the same hue until they reach it (`darkTheme.ts`, below).

## Dark mode on Canvas's React pages (`src/bcx/darkTheme.ts`)

BetterCampus's dark mode is a fixed list of Canvas selectors. Canvas's newer React pages use InstUI components instead, including discussions, New Quizzes and the newer assignment views. Their class names are hashed emotion classes (`.css-1x2y3z-view`) inserted at runtime, so those panels stayed white while their text turned light. Pasted post formatting and @mentions also disappeared or glared.

`darkTheme.ts` runs whenever their `#darkcss` sheet is active, which covers dark mode and themes but not Quiz Safe Mode. It does three things:

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
- **Dashboard card titles** in a course color too dark for a dark card get lighter, in the same hue, until they reach 4.5:1. Each pass reads the course color again, so a recolored course is judged by its new color.

## Checked-off announcements (`src/bcx/announcements.ts`)

Checking off an announcement in the To-Do list's announcements tab only added it to BetterCampus's local `todo_read` list. Canvas still counted it as unread, so the badge on the course card's announcements icon kept counting it until you opened the announcement on Canvas.

Checking one off now also marks it read on Canvas, and unchecking it marks it unread again. The course card's badge changes right away and hides at zero. If Canvas already had the announcement that way (you'd read it on Canvas, say), nothing is sent and the badge stays as it is.

- **Requests.** A `GET` of the announcement for its read state, then `PUT` or `DELETE` on `/api/v1/courses/<course>/discussion_topics/<id>/read`, from your Canvas tab with your session, the same way BetterCampus already saves planner completions.
- **What triggers it.** Their checkbox stores only the announcement's id, and Canvas's API also needs the course. The module notes both from the row you click, which links to `/courses/<course>/discussion_topics/<id>`. It acts only when `todo_read` then changes for that announcement. Other open Canvas tabs, a settings restore or import, and Reset All Preferences don't change anything on Canvas. Other dashboard tabs show the new count after a reload.
- **No patch.** It watches the click and storage instead of hooking the bundle, so it doesn't depend on upstream's minified names.

Announcements you checked off before this build are still unread on Canvas. Uncheck and recheck one to send it, or open it on Canvas.

## Settings backup (`src/bcx/backup.ts`, `src/options/`)

Firefox deletes all of an add-on's storage when the add-on is removed: on uninstall, and at every restart for a copy loaded from `about:debugging`. Installing a new build over the old one counts as an update and keeps everything. Removing it first used to reset every setting.

- **Automatic copy.** On your Canvas site (Other → Your Canvas URL, detected automatically), `bcx.js` keeps a copy of your settings in that site's localStorage, which Firefox leaves alone when the add-on goes. The copy is updated two seconds after a change and checked once per page load. After a fresh install, the first visit to that site writes the copy back, reloads the page, and shows a notice with the copy's date. An install that already has settings never restores over them, so the copy can't undo newer changes or a Reset All Preferences.
- **What's in it.** All of BetterCampus's settings and local data: theme, colors, cards, sidebar, To-Do options and edits, the GPA calculator, the Quick Note, and our own `bcx_*` keys. It leaves out caches of remote data, the device and analytics IDs, account fields and upstream's install bookkeeping (`src/bcx/settings.ts`). If a copy won't fit in the site's 5 MB quota, it drops edited images (embedded `data:` URLs) and keeps everything else.
- **Who can read it.** Canvas's own page scripts can read the site's localStorage, the same as the theme cache BetterCampus already keeps there.
- **Backup file.** `about:addons` → BetterCampus → Preferences opens a page that shows when the automatic copy last ran, and exports your settings to a JSON file or imports them from one. Use it to move to another computer or profile, or before clearing Canvas's site data, which deletes the automatic copy. Firefox's "Delete cookies and site data when Firefox is closed" setting does that at every restart unless Canvas is listed as an exception.

## Load time

BetterCampus injects `all.js` into every page you visit, so its cost lands on all your browsing, not just Canvas. The build cuts that cost in three ways. None of them changes a feature; the one thing that stops working is a hidden developer timing tool (see Profiler).

- **Subframes (now upstream).** Through 9.8.15, `all.js` ran in every frame of every page, including ads, embeds and video players, and initialized all of BetterCampus there (about 300 ms per frame below) only to register the Figtree font and paint a cached anti-flicker style. This port loaded it in the top frame only and did those two jobs with a 3 KB `subframe.js`. Since 9.9.1, upstream itself injects `all.js` in the top frame only and does neither job in subframes, so `subframe.js` is gone. The build stops if `all.js` is ever set to run in subframes again.
- **Profiler.** BetterCampus wraps ~9k functions per bundle in a local profiler (`const e=at("id");try{…}catch(n){throw ot(e),n}finally{st(e)}`). Its spans only record while a hidden debug mode is on, but every call paid for them anyway. The build unwraps them all and drops the span ids nothing reads, so the hidden Debug tab no longer has anything to time.
- **Dead code.** Terser then runs a pass over every bundle that only removes or folds code: no mangling or inlining. It drops what the patches leave unreachable and whatever only that code used, such as the file viewer's annotation toolbar and the campaign card's 842 KB inline image. In 9.9.1, `all.js` goes from 5.1 to 3.6 MiB, `background.js` from 443 to 373 KiB and `viewer.js` from 3.0 to 2.5 MiB.
- **Repeated work.** The `perf` patches above. `bcx.js` is minified, only reads the large `overrides` object when saved session times need checking against it, and the dark-mode fix no longer scans stylesheets while dark mode and themes are off.

Measured against 9.8.15, when `all.js` still ran in every frame, in headless Firefox 158 on a slow virtual machine, so the ratios matter more than the absolute times:

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
bun run upstream -- --download
bun port-to-firefox.ts [--update-patches] [path/to/chrome.zip]
```

This repo doesn't include BetterCampus itself. `bun run upstream` asks the Chrome Web Store for its current version; with `--download` it also saves the package here as `BetterCampus-<version>-Chrome.zip`. The patches target the version in `upstream.json`. The build uses the `*Chrome*.zip` in this directory unless you pass a path. It outputs `firefox/` (unpacked) and `dist/bettercampus-firefox-<version>.xpi`. It also does the Firefox manifest conversion: `background.scripts`, `browser_specific_settings.gecko`, and removing `update_url` and `_metadata/`.

Patch anchors are minified code, and each upstream release renames most minified variables: 9.9.1 turned `Xgt=async t=>{const e=at("03zsvda5")` into `wit=async t=>{const e=rt("03zsvda5")`. So an anchor that no longer matches verbatim is tried again with the minifier's names as wildcards (`scripts/patch.ts`). Those are the 1–3 character identifiers that aren't property names, object keys or reserved words. A name that repeats has to map to the same new name each time, and two names can't map to one. If that matches exactly once, the patch applies with its replacement rewritten to the new names, and `--update-patches` writes the moved anchor back to `patches.json`. A replacement may only use minified names its own anchor contains, since nothing says what any other name became. Such a patch is refused when names change, and `bun scripts/check-patches.ts` (part of `bun run check`) flags it ahead of time. Our own locals in a replacement use `$bcx…` names, which are too long to be the minifier's. The same check flags an anchor that nothing but span ids identifies, like `const t=at("9popk2gd");try{`. Span ids move to neighboring code when upstream reworks a component (9.9.1 moved the theme editor's), and such an anchor would follow them there without failing, so each anchor also includes a string or a property name from its own code. And the build warns about any anchor that matches verbatim but would match more than once with its names as wildcards, since the next rename would break it.

Anything else stops the build, which lists every problem at once: each anchor upstream rewrote, or that matches more than once with its names as wildcards, and each unreviewed addition (see [Automatic updates](#automatic-updates)). Those anchors need re-deriving against the new bundle. Prefer anchors on the stable 8-character `at("…")` instrumentation ids and string literals. When the whole port succeeds, `--update-patches` records the new version in `upstream.json`.

AMO's linter refuses to parse any JS file of 5 MiB or more, which blocks signing, and the patched `all.js` of 9.9.1 is 5.05 MiB. The profiler and dead-code passes above bring it to 3.6 MiB, and the build fails if any file ends up over the limit. Those passes take most of the build's 20 seconds. `bun run lint:ext` runs the same linter as AMO.

## Automatic updates

`.github/workflows/port-upstream.yml` checks the Chrome Web Store every morning (08:41 UTC).

- **A release that ports cleanly.** The workflow builds it, runs AMO's linter, and signs it on AMO as an unlisted add-on. The signed `.xpi` is attached to the run, where GitHub keeps it for 90 days; the repo doesn't publish it anywhere else. The workflow then commits the moved anchors and the new version, tags the commit `v<version>`, and opens an issue that @-mentions you with the download link. Install it as in [Install](#install), step 3.
- **A release that doesn't.** The workflow opens an issue for that version listing every problem the build found, with the steps to port it by hand. Later runs update that issue instead of opening more. Pushing the finished port to `main` (with its version in `upstream.json`) makes the workflow sign it.
- **A rebuild.** Actions → Port upstream release → Run workflow, with a build number, signs the current version again as `<version>.<build>`, for example after a change to `src/`.

Each version is signed once: a run skips any version that already has its `v<version>` tag.

**Setup.** Add your AMO API credentials ([Manage API Keys](https://addons.mozilla.org/developers/addon/api/key/)) as the repository secrets `WEB_EXT_API_KEY` and `WEB_EXT_API_SECRET` under Settings → Secrets and variables → Actions. Without them the workflow stops before signing and says so in an issue. GitHub disables scheduled workflows in a public repo after 60 days with no activity in it. The workflow's own commits count, but if a quiet stretch upstream outlasts that, re-enable it under Actions.

**Upstream review list (`upstream.json`).** Besides the version `patches.json` is for, `upstream.json` lists what of upstream has been reviewed: its manifest keys, its permissions, the content scripts we ship, and every host the shipped files name. A release that adds any of them stops the build until someone looks at it, then lists it there or strips it. That way, an automatic port can't quietly ship another bridge to bettercampus.com, a new permission or a new analytics endpoint.

**What it can't catch.** The port carries over the existing patches. A new upsell, AI or cloud feature that a release builds on reviewed hosts and existing code stays in until a patch removes it, so look over each release once it's installed.

## Install

Release Firefox only installs add-ons signed by Mozilla. Signing it as an **unlisted** (self-distributed) add-on is free and automated; it isn't published on AMO. With [automatic updates](#automatic-updates) set up, the workflow does steps 1 and 2 for each new release; download its `.xpi` from the run and go to step 3.

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

AMO signs each version number once per add-on ID. To sign a rebuild of the same upstream version, build with a fourth version part: `BUILD=2 bun run build` turns `9.9.1` into `9.9.1.2`. Installing a newer signed build replaces the old one and keeps your settings, since the add-on ID stays the same. If you remove the old one first, opening Canvas brings them back from the [settings backup](#settings-backup-srcbcxbackupts-srcoptions).

Unlisted add-ons can still be manually reviewed by Mozilla at any time, and reviewers may ask for unminified source, which this port doesn't have.

To test without signing, open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on…**, and pick `firefox/manifest.json`. That copy and its storage are removed when Firefox restarts; after loading it again, opening Canvas restores your settings from the backup. Developer Edition, Nightly and ESR can also install the unsigned `.xpi` after setting `xpinstall.signatures.required` to `false` in `about:config`.

## Known limitations

- The toolbar button does nothing on non-Canvas tabs, because it used to open the remote setup page. Visit your Canvas site and it is detected automatically, or set the URL under Other → Your Canvas URL.
- Free plans still get one focus session per assignment ("Plan another focus session" keeps its Pro crown).
- Planned-session reminders are still Pro-only, so a session's time doesn't trigger a notification.
- The browser APIs differ from Chrome in a few spots: there is no eyedropper in the color picker, and the rate link still points to the Chrome Web Store.
