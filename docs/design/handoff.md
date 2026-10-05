# Redesign handoff

The redesign makes the app low-friction to start and makes progress visible. The primary
user trains at home with dumbbells 3–4×/week and has ADHD, so **removing decisions before
starting a workout is the #1 requirement.**

The original handoff came as HTML design references (a clickable prototype and a static
canvas of every screen in both themes). They are treated as a mockup rather than a final
spec: the decisions that changed it are listed in [build-plan.md](build-plan.md).

## Design tokens

### Colour: two themes
Day, Night, or Match system, chosen per device (`theme_v1`) and applied as
`html[data-theme]`. The `theme-color` meta tag follows the theme.

| Token | Day | Night | Use |
|---|---|---|---|
| bg | #F4F2EE | #141517 | app background |
| surface | #FFFFFF | #1E2023 | cards, tab bar |
| surface-2 | #EDEAE4 | #2A2D31 | stepper buttons, segmented track, ring track |
| ink | #1E2024 | #ECEAE5 | primary text, active tab, chart highlight |
| soft | #62656B | #9C9FA5 | secondary text, labels |
| faint | #9A9CA1 | #6E7177 | index numbers, axis labels |
| line | #E4E1DB | #2A2D31 | dividers, chip borders |
| bar | #DCD8D0 | #33363B | inactive chart bars, sheet handle |
| accent | #CFE3A6 (pistachio) | #E6AE8E (apricot) | primary buttons, done sets, PR tags |
| on-accent | #1E2024 | #1A1310 | text on accent |
| strong / on-strong | #1E2024 / #FFFFFF | #ECEAE5 / #141517 | selected chip, toast |
| activity / on-activity | #B7CCE0 / #1E2024 | #8FA8BF / #141517 | ACT tag, activity calendar cells |
| warn / warn-text | #E2C27E / #7A5A12 | #C9A964 / #D9BD80 | recovery: recovering |
| stop / stop-text | #E0A592 / #93432B | #C9806B / #E0A190 | recovery: rest today, destructive text |

The accents are deliberately soft. Bright lime and orange were distracting, so don't saturate them.

### Type
- **Instrument Sans** 400/500/600: all UI text.
- **Geist Mono** 400/500: numbers, timers, uppercase labels, minute chips.

| Role | Font | Size / weight |
|---|---|---|
| Screen title | Instrument Sans | 24px / 600, letter-spacing −0.015em |
| Today workout title | Instrument Sans | 26px / 600 |
| Done title | Instrument Sans | 30px / 600 |
| Exercise name (live) | Instrument Sans | 24px / 600 |
| Card title | Instrument Sans | 15–16.5px / 600 |
| Body / list row | Instrument Sans | 14–14.5px / 500 |
| Secondary | Instrument Sans | 12.5–13.5px / 400–500, soft |
| Label (uppercase) | Geist Mono | 11px / 500, letter-spacing .06em, soft |
| Live reps/weight | Geist Mono | 50px / 500, letter-spacing −0.04em |
| Rest countdown | Geist Mono | 62px / 500 |
| Stat numbers | Geist Mono | 20–24px / 500 |

The phone is close to the user during a workout, so nothing is oversized. Don't scale these up.

### Spacing, radius, sizing
- Side padding 20px; top padding clears the status bar (`safe-area-inset-top`).
- Gaps between cards 6–10px, between sections 18–22px.
- Radius: chips 9px, small buttons 10–12px, cards 14–16px, primary buttons 14–16px, sheets 22px top corners.
- Primary button 54px tall (58px for "Set done"). Steppers 48×48px. Minimum hit target 44px.
- Tab bar: a 3×18px indicator above a 12px label.
- No shadows except the toast and the active segmented pill.

## Screens

1. **Today.** Date and a weekly-goal pill (squares plus "2/4 this week", opens Progress).
   Title "{Focus} · {minutes} min"; tapping it opens a focus sheet to override the
   automatic pick. An AI reason line when the plan came from the AI. A numbered exercise
   list with `sets×reps · weight`. Minute chips (20 / 30 / 45 / Custom) and Shuffle,
   a primary **Start workout →** button, and a link that opens the activity sheet.
   After a workout is saved, a banner reads "✓ Today's workout is logged."
2. **Live set** (no tab bar). ✕ End, elapsed time, Swap. One progress segment per
   exercise. "EXERCISE 2 OF 5", the name, "Last time: 3×10 @ 40 lb". Set pips, REPS
   (or SECONDS, ±5) and LB (±5, "BW" at 0) steppers, "Set N done" with a hint underneath.
3. **Rest** (no tab bar). Starts after each set: a conic ring with the countdown,
   −15s / +15s, an "Up next" card and Skip rest. At 0 it chimes (two 880Hz beeps),
   vibrates, and returns to the set.
4. **Workout complete.** "WORKOUT 3 OF 4 THIS WEEK", "Done. Nice work.", a streak line,
   three stats (minutes, sets, lb moved), and "BETTER THAN LAST TIME" tags, or
   "SHOWED UP. THAT COUNTS." when nothing improved. Save workout.
5. **Progress.** Goal-streak card (weeks that hit the goal), weekly volume (8 bars with
   a % change), and "Lifts going up" (a 6-session sparkline and from → to per lift).
6. **History.** A 30-day calendar (strength cells in ink, activity cells in the activity
   colour), then Recent cards with weekday and date, name, meta, a volume bar for
   strength, ACT or PR tags, and a ⋯ menu to delete. An Export shortcut in the header.
7. **Log activity** (bottom sheet). Recent-activity chips plus "Other…", duration
   stepper (±5), optional distance, effort (Easy / Moderate / Hard), notes, Save.
8. **Settings.** Theme, weekly goal, rest between sets, preference toggles (AI picks my
   workout, chime and vibrate when rest ends, keep screen awake), then Account & data:
   sync, equipment, and Export & import (JSON backup, CSV, Copy for AI, import).

Recovery and Routines screens exist in the mockup and are planned for later.

## State
New localStorage keys. All except the theme mirror to the Firestore profile.

- `theme_v1`: `'day' | 'night' | 'system'` (per device).
- `weeklyGoal_v1` (default 4) with a goal history so past weeks keep the goal they had,
  `restSeconds_v1` (default 90), `chime_v1`, `keepAwake_v1`, `aiPick_v1`.
- `todayPlan_v1`: today's generated plan, so reopening the app shows the same workout.
- `activeSession_v1`: the in-progress live workout, persisted on every change so a reload
  or a locked phone resumes it.

Live session: `{ exercises:[{...plan, done:[{reps,weight}]}], ex, set, reps, weight,
phase:'set'|'rest', restEndsAt, restTotal, startedAt }`. The rest timer reads
`restEndsAt`, so it stays correct after the phone is backgrounded.

Saving writes the existing entry shape (`{id, date, duration, region, exercises:[{name,
sets, reps, weight, unit}]}`), with `sets` as the number of sets done and `reps`/`weight`
from the last set, plus an optional per-exercise `log` of every set.
