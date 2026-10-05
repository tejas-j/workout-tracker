# CLAUDE.md: Training Log

## What this is
A mobile-first workout planner and tracker PWA (train.tejasrj.io). Vanilla HTML/CSS/JS with **no build step and no framework**. Keep it that way.

- `index.html`: markup for the screens, sheets and tab bar, plus an inline script that applies the theme before first paint.
- `styles.css`: design tokens (Day/Night) and components.
- `app.js`: state, UI, logging, history, suggestions and sync glue.
- `stats.js`: pure functions for weeks, goal and streak, volume, lift trends and PRs.
- `exercises.js`: exercise library, `REGIONS`, `EQUIPMENT_PRESETS`, `ACTIVITIES`, `buildLibraryWorkout`.
- `firebase-sync.js`: Firebase Auth and Firestore wrapper (ES module, exposes `window.cloud`).
- `sw.js`: service worker (stale-while-revalidate). **Bump its cache version whenever shell files change.**
- `worker/`: Cloudflare Worker that proxies Gemini with tiered daily limits (see `worker/README.md`).

## Who it's for
The primary user trains at home with dumbbells 3–4×/week and has ADHD. The two product goals are:
1. **Zero decisions to start.** Today must open on a ready-to-go workout with one Start button. Never add a required choice before Start.
2. **Progress you can see.** Weekly goal, streak, lifts going up, and "better than last time" after each workout.

## Design
- `docs/design/handoff.md`: tokens, type scale and screen specs.
- `docs/design/build-plan.md`: the phased plan, with the product decisions made along the way. Tick boxes as you go.

## Rules
- **localStorage is the source of truth.** Every write goes local first, then `cloudCall(...)` to Firestore. Never block the UI on the network.
- **Don't break the data model.** Existing workout and activity entries (see the README) must keep loading. New fields are additive and optional.
- New settings use versioned keys (`foo_v1`). Synced settings live in the Firestore profile (`users/{uid}/settings/profile`, newest edit wins); the theme is per device and never synced.
- HTML-escape all user and model text with `esc()` before rendering.
- Styling: CSS custom properties per theme on `html[data-theme="day"|"night"]` (`--bg`, `--surface`, `--surface-2`, `--ink`, `--soft`, `--faint`, `--line`, `--bar`, `--accent`, `--on-accent`, `--strong`, `--on-strong`, `--activity`, `--on-activity`, `--warn`, `--warn-text`, `--stop`, `--stop-text`). Do not hard-code hex values in components.
- Fonts: Instrument Sans (UI) and Geist Mono (numbers and labels) from Google Fonts, cached by the service worker.
- Keep sizes as specced. Nothing oversized. Minimum hit target 44px.
- Accents are intentionally soft (pistachio, apricot). Don't saturate them.
- Timers derive from timestamps (`restEndsAt`), never from decrementing counters.
- Respect `prefers-reduced-motion`. Transitions ≤ 200ms, opacity and transform only.
- Never commit secrets: the Gemini key and owner emails are Worker secrets. The Firebase web config is public by design.

## Conventions
- Branches: `feature/<area>` (for example `feature/live-workout`), `fix/<area>`.
- Commits: Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`).
- Files: kebab-case.

## Testing
- `python3 -m http.server 8000`, then open `http://localhost:8000` at a 390px viewport. Check both themes.
- `node tests/stats.test.js` runs the unit tests for the derived stats.
- `cd worker && npm test` runs the Worker tests.
- Before each commit, check by hand: start → complete all sets → rest auto-start and auto-end → complete → save. Then the entry appears in History, the goal count updates, and a reload mid-workout resumes the session.
