# Training Log

A local-first personal workout tracker: logs strength workouts and suggests
a daily workout (via the Anthropic API) based on time available and recent
history.

## Status

**Local-first PWA, no backend.** History and settings live in browser
localStorage. Move data between devices with **Settings → Backup & restore**
(download a JSON file, import it elsewhere; imports merge by workout id).

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
- [ ] Cross-device sync (Firebase Auth + Firestore, or similar) with login
- [ ] Host on tejasrj.io (currently planned as a subdomain)
- [ ] Optional server-side proxy for the Anthropic key if sharing with others
