# Training Log

A local-first personal workout tracker: logs strength workouts and suggests
a daily workout (via the Anthropic API) based on time available and recent
history.

## Status

**Local-first PWA with optional Google sign-in sync.** History and settings
always live in browser localStorage first. Signing in (Settings → Sync) mirrors
them to Firestore under `users/{uid}/workouts/{id}` and
`users/{uid}/settings/profile`, so other devices pick them up. Signed out, the
app works fully offline and local-only. **Backup & restore** (JSON file) still
works as a manual safety net; imports merge by workout id.

**Guest mode** uses Firebase anonymous auth: it backs up the current device's
data to the cloud without a Google account, but a guest account is tied to that
browser, so it can't sync to other devices and is lost if site data is cleared.
"Link Google account" upgrades the guest to Google while keeping its data.

Sync details: it runs on sign-in, on "Sync now", and when the app returns to the
foreground. Workouts merge by id; a workout deleted on another device is dropped
here rather than resurrected; equipment is last-edit-wins. The Anthropic key is
never synced.

### Firebase setup

The Firebase web config in `firebase-sync.js` is public by design. Security
comes from Firestore rules, which must restrict access to your account:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid}/{document=**} {
      allow read, write: if request.auth != null
                         && request.auth.uid == uid
                         && request.auth.uid == "YOUR_UID";
    }
  }
}
```

Add every domain you serve from (e.g. `tejasrj.io`) under Authentication →
Settings → Authorized domains. The SDK is loaded from Google's CDN (no build
step).

## Running it

Open `index.html` directly, or serve the folder (`python3 -m http.server`)
to get the installable PWA / offline support (service workers need http(s)).
To use it on an iPhone, host it over HTTPS and use Share → Add to Home Screen.

## How suggestions work

Pick minutes and a focus: full body, upper, lower, push, pull, chest, back,
shoulders, arms, legs, glutes, core, cardio/conditioning, or mobility/stretching.
Then hit **Suggest a workout**.

- **No API key:** the app builds a workout from the curated library in
  `exercises.js` (~170 exercises), filtered by your equipment, fitted to your
  time, and preferring exercises you haven't done recently. Weights default to
  your last logged weight for that exercise.
- **With your own Anthropic API key** (Settings): Claude Haiku suggests a
  workout from your time, focus, equipment (including custom items) and recent
  history, including logged sports/cardio activities. If the call fails it falls
  back to the library.

The key is stored only in your browser and sent only to Anthropic, which is why
each user supplies their own. Don't paste a key on a shared device.

## Shared AI access (proxy)

`worker/` is a Cloudflare Worker that holds an Anthropic API key so the browser
never sees it. The app uses it when `AI_PROXY_URL` (top of the script in
`index.html`) is set and the user is signed in with Google. The Worker:

- verifies the Firebase ID token (signature, issuer, audience, expiry),
- rejects guest (anonymous) accounts and any email not in `ALLOWED_EMAILS`,
- only allows calls from `ALLOWED_ORIGINS`,
- picks the model and output cap itself, caps prompt size, and
- optionally enforces a per-user daily limit (`DAILY_LIMIT`, needs the `USAGE` KV namespace).

Order of preference in the app: your own key (Settings) → shared proxy → built-in library.
Anyone not on the allowlist silently gets library workouts.

### Deploying the Worker

```
cd worker
npm install
npx wrangler login                      # opens Cloudflare in the browser
npx wrangler kv namespace create USAGE  # optional: paste the id into wrangler.toml
npx wrangler secret put ANTHROPIC_API_KEY
# edit ALLOWED_EMAILS in wrangler.toml
npx wrangler deploy                     # prints the https://workout-ai.<you>.workers.dev URL
```

Then set `AI_PROXY_URL` in `index.html` to that URL. Run `npm test` in `worker/`
for the auth/validation tests (no API calls).

Also set a monthly spend limit on the key's workspace in the Anthropic Console,
so a bug or abuse can't cost more than you choose.

## Logging activities

The log card has two modes: **Strength** (exercises with sets/reps/weight) and
**Activity / sport** for things like an outdoor walk, run, hike or pickleball:
activity name (pick from the list or type your own), duration, effort, optional
distance and notes.

## Equipment

Settings → Equipment: toggle presets (dumbbells, bench, pull-up bar, bands,
kettlebell, barbell, squat rack, medicine ball, stability ball, suspension
trainer, jump rope, ab wheel, plyo box, foam roller, sliders, cable machine,
treadmill, stationary bike, rowing machine, elliptical) or add custom items.
Presets filter the library; custom items are passed to the AI only. Bodyweight
is always available.

## Data model

Workouts are stored as:
```json
{
  "id": 1234567890,
  "date": "2026-07-15T00:00:00.000Z",
  "duration": 30,
  "region": "upper",
  "exercises": [
    {"name": "Dumbbell bench press", "sets": 3, "reps": 10, "weight": 35}
  ]
}
```

Activity entries use `"type": "activity"` with `activity`, `duration`, and
optional `distance`, `distanceUnit`, `effort` and `notes` (`exercises` is `[]`).
Exercise `unit` is omitted for reps, `"sec"` for timed sets, `"min"` for steady
cardio blocks.

## Roadmap

- [x] Region of focus, editable equipment, library fallback, backup/restore, PWA
- [x] Cross-device sync (Firebase Auth + Firestore) with Google login
- [ ] Host on tejasrj.io (currently planned as a subdomain)
- [x] Server-side proxy for a shared Anthropic key (allowlisted Google accounts)
