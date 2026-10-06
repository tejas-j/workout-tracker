# Architecture

Training Log is a local-first progressive web app. Everything runs in the browser;
two small cloud services add sync and AI planning, and the app keeps working without
either of them.

```
                   ┌──────────────────────────── Phone / browser ────────────────────────────┐
                   │                                                                          │
                   │   index.html + styles.css      UI: Today, Progress, History, Settings,    │
                   │                                live workout, bottom sheets                │
                   │   app.js                       state, plan, live session, sync glue       │
                   │   exercises.js  planner.js     exercise library · time budgets and fitting│
                   │   stats.js                     derived stats                              │
                   │   localStorage                 source of truth for all data               │
                   │   sw.js (service worker)       caches the app shell for offline use       │
                   │                                                                          │
                   └───────────┬──────────────────────────────┬───────────────────────────────┘
                               │ sync (optional)              │ AI plan (optional)
                               ▼                              ▼
                   ┌───────────────────────┐      ┌─────────────────────────────┐
                   │ Firebase              │      │ Cloudflare Worker           │
                   │  Auth (Google, guest) │◄─────│  verifies Firebase ID token │
                   │  Firestore (per user) │ keys │  daily limits (Durable Obj.)│
                   └───────────────────────┘      └──────────────┬──────────────┘
                                                                 ▼
                                                     ┌──────────────────────┐
                                                     │ Google Gemini API    │
                                                     └──────────────────────┘

   Hosting: GitHub Pages (from main) at train.tejasrj.io, DNS on Cloudflare
```

## Principles
- **Local first.** Every change is written to `localStorage` first, then mirrored to the
  cloud in the background. The UI never waits on the network.
- **No build step.** Plain HTML, CSS and JavaScript served as static files.
- **Graceful fallback.** No sign-in means data stays on the device. No AI means the
  built-in exercise library plans the workout.
- **Secrets stay server-side.** The Gemini key and owner emails live only in the
  Worker's secret store. The Firebase web config is public by design; Firestore rules
  enforce access.

## Front end

| File | Role |
|---|---|
| `index.html` | Markup for every screen and sheet; applies the theme before first paint |
| `styles.css` | Design tokens for the Day and Night themes, and all components |
| `app.js` | App state, Today's plan, live workout, progress, history, export, sync |
| `exercises.js` | ~185 exercises, focus areas, equipment presets and time estimates |
| `planner.js` | Time budget per session, library plans, fitting AI plans to the time, AI prompts |
| `stats.js` | Pure functions: weeks, weekly goal and streak, volume, lift trends, PRs |
| `firebase-sync.js` | Firebase Auth and Firestore wrapper, exposed as `window.cloud` |
| `sw.js` | Service worker: stale-while-revalidate cache for offline use |

### Main flows
- **Today.** On open, a plan is built from the library for the automatic focus
  (rotating upper → lower → full body). If AI is on, a better plan is requested in the
  background and swapped in. The plan is kept for the day.
- **Time budget.** `planner.js` turns the minutes and focus into a budget: 2–3 minutes
  for warm-up, a session kind (quick ≤ 20 min, strength, core, cardio, mobility, or
  recovery for short mobility), a target exercise count (soft cap of 8 for strength) and
  a limit of about 10% over. Library and AI plans both go through `fitPlan()`, which
  matches names to the library, trims plans that run long and tops up ones that are
  well short.
- **Live workout.** A session object (exercises, sets done, current set, rest end time)
  is saved to `localStorage` on every change, so a reload or locked phone resumes it.
  The rest timer is computed from a timestamp, not a countdown.
- **Save.** The finished session becomes a normal workout entry, then History,
  Progress and the weekly goal update from it.
- **Progress.** Streak, volume and lift trends are computed on the fly from the
  workout log by `stats.js`; nothing derived is stored.

## Data

Stored on the device in `localStorage` (versioned keys):

| Key | Contents |
|---|---|
| `workoutLog_v1` | All workouts and activities |
| `equipment_v1` | Equipment the user owns |
| `settings_v1` | Weekly goal and its history, rest length, AI, chime, keep-awake |
| `todayPlan_v1` | Today's plan |
| `activeSession_v1` | The workout in progress |
| `theme_v1` | Day, Night or system (this device only) |

Mirrored to Firestore when signed in:

```
users/{uid}/workouts/{id}        one document per workout or activity
users/{uid}/settings/profile     equipment and settings (newest edit wins)
```

Sync runs on sign-in, on demand and when the app returns to the foreground. Workouts
merge by id, and deletions on one device are removed on the others.

## AI planning
1. The app sends the system prompt (a shared base plus rules for the session kind), the
   user prompt (the budget, equipment, a shortlist of library exercises and the last 10
   entries) and a JSON schema to the Worker. Signed-in Google users attach their
   Firebase ID token.
2. The Worker checks the origin and request size, verifies the token, picks a tier and
   checks the daily limits in a Durable Object (exact counters, reset at midnight
   Pacific).
3. The Worker calls Gemini with the model, output limit and temperature it chooses, and
   returns the JSON plan.
4. The app fits the plan to the time budget, prefers the user's logged weights, and shows it.

| Tier | Who | Daily limit |
|---|---|---|
| Owner | Emails in the `OWNER_EMAILS` secret | 100 each |
| Member | Other signed-in Google users | 20 each, 150 total |
| Public | Signed out or guest, per hashed IP | 5 each, 50 total |

## Testing
- `node tests/stats.test.js`: unit tests for the derived stats.
- `node tests/planner.test.js`: time budgets, fitting and prompt sizes for every focus and length.
- `cd worker && npm test`: Worker tests (auth, tiers, limits, day rollover, Gemini errors).
- The UI is checked in a browser at a phone-sized viewport in both themes.
