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

Pick minutes, a focus (full body, upper, lower, chest, back, shoulders, arms,
legs, core) and hit **Suggest a workout**.

- **No API key:** the app builds a workout from the curated library in
  `exercises.js`, filtered by your equipment, fitted to your time, and
  preferring exercises you haven't done recently. Weights default to your last
  logged weight for that exercise. No history-based recommendations.
- **With your own Anthropic API key** (Settings): Claude Haiku suggests a
  workout from your time, focus, equipment (including custom items) and recent
  history. If the call fails it falls back to the library.

The key is stored only in your browser and sent only to Anthropic, which is why
each user supplies their own. Don't paste a key on a shared device.

## Equipment

Settings → Equipment: toggle presets (dumbbells, bench, pull-up bar, bands,
kettlebell, barbell) or add custom items. Presets filter the library; custom
items are passed to the AI only. Bodyweight is always available.

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

## Roadmap

- [x] Region of focus, editable equipment, library fallback, backup/restore, PWA
- [x] Cross-device sync (Firebase Auth + Firestore) with Google login
- [ ] Host on tejasrj.io (currently planned as a subdomain)
- [ ] Optional server-side proxy for the Anthropic key if sharing with others
