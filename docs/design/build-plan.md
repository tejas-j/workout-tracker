# Redesign build plan

Each phase ships on its own branch and is merged to `main` after testing.

## Decisions
- **Tabs:** Today · Progress · History · Settings. Routines come later.
- **Theme:** Day, Night or Match system, per device. No text-size setting.
- **Today:** the plan is generated automatically, but tapping the title opens a focus
  sheet to override it. The automatic focus rotates upper → lower → full body based on
  the last strength session. A recovery map can replace this later.
- **Minutes:** chips for 20, 30 and 45, plus Custom (typed in; it then shows as the
  selected fourth chip).
- **Streak:** weekly. A week counts when the number of active days reaches that week's
  goal. Activities count. Changing the goal never rewrites past weeks.
- **Settings sync:** goal, rest length and toggles sync through Firebase. Theme is per device.
- **Vibration** is folded into the chime toggle.
- **Export & import** lives in Settings → Account & data, with an Export shortcut in the
  History header: JSON backup (share sheet on phones), CSV with one row per exercise,
  "Copy for AI" (a text summary with a prompt), and JSON import that merges by id.
- **AI:** Gemini through the Worker. The bring-your-own Anthropic key option was removed.
- **Deferred:** after-workout AI note, "felt easy" (RPE) tracking, recovery map, routines.

## Phase 1: New look and themes · `feature/redesign-foundation`
- [x] CSS variables for Day/Night on `html[data-theme]`
- [x] Instrument Sans + Geist Mono and the new type scale
- [x] Theme setting (`theme_v1`, with Match system), applied before first paint
- [x] `theme-color` per theme and new manifest colours
- [x] Bottom tab bar
- [x] Restyle cards, inputs, buttons, chips and segmented controls
- [x] Settings regrouped into lists, with sheets for sync, equipment and Export & import
- [x] Export & import: JSON, CSV, Copy for AI, import
- [x] Remove the Anthropic key option
- [x] Bump the service worker cache and cache the fonts

## Phase 2: Today, one tap to start · `feature/redesign-today`
- [ ] Generate today's plan on load (library first, AI when enabled); no Suggest button
- [ ] Keep the plan for the day (`todayPlan_v1`) so reopening the app doesn't reshuffle
- [ ] Automatic focus (rotation) with a focus override sheet
- [ ] Minute chips 20 / 30 / 45 / Custom regenerate the plan; Shuffle re-rolls it
- [ ] AI reason line (a `reason` field in the AI's JSON)
- [ ] Activity bottom sheet: recent chips, Other…, duration stepper, distance, effort, notes
- [ ] Manual workout logging moves to a sheet (History → + Log)

## Phase 3: Live workout and rest timer · `feature/live-workout`
- [ ] Live set screen: progress segments, set pips, steppers, "Last time" line
- [ ] `activeSession_v1` persisted on every change; resume on load
- [ ] Rest screen: conic ring, ±15s, skip, up next; starts after each set
- [ ] Chime (two 880Hz beeps) and vibration at 0
- [ ] Screen Wake Lock during a session
- [ ] Swap exercise (same group, allowed by equipment)
- [ ] End early saves what's done; with no sets done, discard
- [ ] Workout complete: stats, "better than last time", Save
- [ ] Settings: rest length, chime, keep awake, AI picks my workout (synced)

## Phase 4: Progress, goal and streak · `feature/progress-history`
- [ ] Weekly goal 3 / 4 / 5 with goal history, synced
- [ ] Goal pill on Today
- [ ] Goal streak over weeks (activities count)
- [ ] Weekly volume: 8 bars and % change
- [ ] Lifts going up: top 3 by weight gain, 6-session sparkline
- [ ] History: 30-day calendar, volume bars, ACT / PR tags, ⋯ to delete

## Later
- [ ] Recovery map: readiness per muscle group from everything logged, fed into the focus pick and the AI prompt
- [ ] Routines, including a bodyweight "Bad-day 10" starter
- [ ] Per-set "felt easy" tap to drive weight progression
- [ ] After-workout AI note
- [ ] Rest-timer notification when the app is backgrounded
- [ ] App name
