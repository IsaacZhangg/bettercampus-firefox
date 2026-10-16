# BetterCampus for Firefox (stripped)

An unofficial Firefox port of the [BetterCampus (prev. BetterCanvas)](https://chromewebstore.google.com/detail/cndibmoanboadcifjkjbdpjgfedanolh) Chrome extension, with its cloud, AI, account and upsell layers removed. The classic local features stay: dark mode, themes and the community theme browser, custom fonts, dashboard card grades/tasks/colors, the To-Do list, the GPA calculator, the Quick Note and Grades widgets, the sidebar and search bar.

## What's removed

`patches.json` holds 83 string patches against the minified bundle. Each one has a `group` and a `why`.

| Group | Removes |
| --- | --- |
| `menu` | The remote ext.bettercampus.com app shell (hub, planner, grades, notes, study, locker, explore, login). The menu opens the extension's built-in local settings panel instead. |
| `promos` | Campaign popups, the welcome tab and referral capture on install, the what's-new tour, the uninstall survey URL, upgrade/paywall dialogs, the rate-us prompt, and the sidebar "Join free / Upgrade / Refer a friend" footer. |
| `page` | Canvas-page injections: the Planner/Notes/Grades/Study sidebar items, the AI syllabus CTA, the calendar Sync buttons, the "+ Create" card button, AI reminder prompts, cloud grade links, and the remote dashboard widgets. |
| `cleanup` | Leftovers found by rendering the build: cloud/AI widgets in the Widgets catalog, the Calendar Sync and Streaks settings, the AI Transparency row, the "Create free account" theme wall, the GPA history dialog's Upload Transcript tab (a cloud AI import), settings text that still mentioned calendar sync or a BetterCampus account, and background settings-sync and streak requests. |
| `removals` | Fun widgets (the floating music/timer/dino/quote/breathe widgets and the Doge dashboard widget), file annotations (the PDF annotation layer in the Canvas file viewer and its settings), and auto-rotating themes (the header button and the Appearance section). |
| `bcx` | Hooks that hand some Pro-locked controls to our own implementations in `src/bcx/` (below). |
| `telemetry` | PostHog usage analytics, sent straight to `us.i.posthog.com` from the background script, the page content script and the file viewer, plus the startup call that links the anonymous analytics ID to an account. Each of these first asks BetterCampus's own analytics consent check, which now always answers no, whatever the stored `anonymous_usage_data` setting says. |

## Our own versions of Pro features (`src/bcx/`)

These are written from scratch rather than unlocked. They have their own code and UI. They save only through paths free users already have, and they never run BetterCampus's gated code or write its gated settings. Their locked controls call `globalThis.__bcx(...)`. That function lives on the content-script global, so web pages can't trigger it.

| Feature | What ours does |
| --- | --- |
| Card / sidebar / background image editing | Our editor (`cardImage.ts`) replaces their cropper. You pan to crop and can zoom, rotate, flip, and pick from our own filter presets with an intensity slider. Edits are baked into a WebP that is saved through the same setter as their free "paste an image URL" path. Animated images can be kept unedited. |
| Agenda day navigation | When their ←/→ moves off today, our day view (`agenda.ts`) builds that day from the free data their today view uses: class schedule, cached Canvas to-dos, overrides, planned sessions and events. It renders inside their widget with their own list component. "Jump to today" hands back to their view. A calendar button in the To-Do List header opens the Agenda, since their remote hub was its only launcher. |
| Custom To-Do timeframe | "Custom" in any timeframe dropdown (dashboard header, Settings → To-Do, Settings → Dashboard) opens our picker (`todoRange.ts`). It sets a rolling window of 1–30 days, 1–25 weeks or 1–6 months starting today. The range is stored in our own `bcx_todo_range` key. While it's active, the list asks our module for its date window and arrow step; their free list pipeline then loads and groups that window, and the header shows e.g. "10 Days". Picking Day/Week/Month, or "Turn off" in the picker, ends it. |
| Focus-session time of day | In a focus session's "Planned at" popover, our column (`sessionTime.ts`) replaces their Pro time picker. It offers All-Day, four time-of-day presets (Morning 10:00, Afternoon 2:00, Evening 6:00, Night 10:00, the same slots their auto-planner uses) and an exact time field. The time is saved per session in our own `bcx_session_times` key; their saved date stays on the free All-Day value. The session row then reads e.g. "Oct 20 at 6:00pm", and moving the session to another day keeps its time. Times show only in the session editor: the Agenda doesn't list focus sessions. |

Our dialogs use the same theme variables as BetterCampus's own UI, so they follow dark mode and custom themes. When opened from the settings panel, they mount in the panel's portal. The page portal can't be used because the panel scales the page down into its preview.

`bun port-to-firefox.ts` compiles `src/bcx/main.ts` into `content-scripts/bcx.js` and loads it after `all.js`. `bun run check` type-checks and lints it.

The manifest also drops `googlecalendar.js`, `outlookcalendar.js` and `stripe.js`, which only served calendar sync and checkout.

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

## Build

```sh
bun install
bun port-to-firefox.ts [path/to/chrome.zip]
```

This repo doesn't include BetterCampus itself. Supply the extension's Chrome Web Store package as a `.zip`; the patches target version 9.8.15. The script uses the `*Chrome*.zip` in this directory unless you pass a path. It outputs `firefox/` (unpacked) and `dist/bettercampus-firefox-<version>.xpi`. It also does the Firefox manifest conversion: `background.scripts`, `browser_specific_settings.gecko`, and removing `update_url` and `_metadata/`.

Patch anchors are minified code, so a new upstream version will likely break some of them. The script stops and names each patch whose anchor no longer matches exactly once; those need re-deriving against the new bundle. Prefer anchors on the stable 8-character `at("…")` instrumentation ids and string literals.

AMO's linter refuses to parse any JS file of 5 MiB or more, which blocks signing, and the patched `all.js` is 5.19 MiB. For any file over the limit, the script parses it with acorn and removes the try/catch/finally around each of BetterCampus's ~9k local profiler spans (`const e=at("id");try{…}catch(n){throw ot(e),n}finally{st(e)}`). Those spans only record while a debug flag is on, so the code runs the same; `all.js` drops to 4.85 MiB. The build fails if a file is still over the limit. `bun run lint:ext` runs the same linter as AMO.

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

AMO signs each version number once per add-on ID. To sign a rebuild of the same upstream version, build with a fourth version part: `BUILD=2 bun run build` makes `9.8.15.2`. Installing a newer signed build replaces the old one and keeps your settings, since the add-on ID stays the same.

Unlisted add-ons can still be manually reviewed by Mozilla at any time, and reviewers may ask for unminified source, which this port doesn't have.

To test without signing, open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on…**, and pick `firefox/manifest.json`. That copy is removed when Firefox restarts. Developer Edition, Nightly and ESR can also install the unsigned `.xpi` after setting `xpinstall.signatures.required` to `false` in `about:config`.

## Known limitations

- The toolbar button does nothing on non-Canvas tabs, because it used to open the remote setup page. Visit your Canvas site and it is detected automatically, or set the URL under Other → Your Canvas URL.
- Free plans still get one focus session per assignment ("Plan another focus session" keeps its Pro crown).
- Planned-session reminders are still Pro-only, so a session's time doesn't trigger a notification.
- The browser APIs differ from Chrome in a few spots: there is no eyedropper in the color picker, and the rate link still points to the Chrome Web Store.
