# Training Log

A local-first personal workout tracker: logs strength workouts and suggests
a daily workout (via the Anthropic API) based on time available and recent
history.

## Status

**Local prototype.** Data currently lives in browser localStorage only — no
sync across devices yet. Hosting/sync (GitHub-repo-as-datastore or Firebase)
is the next step.

## Running it

Just open `index.html` in a browser. No build step, no dependencies.

## Using the suggestion feature

1. Go to the **Settings** tab.
2. Paste an Anthropic API key (get one at https://console.anthropic.com).
3. The key is stored only in your browser's localStorage — it is never
   written into this codebase and never committed to git.
4. Go to **Today**, set minutes available, click "Suggest a workout."

**Important:** this prototype calls the Anthropic API directly from the
browser (using the `anthropic-dangerous-direct-browser-access` header).
That's fine for local use on your own machine, but it is **not safe to
deploy publicly as-is** — anyone opening dev tools on a hosted version
could read the key out of outgoing requests. Before hosting this
publicly, the API call needs to move behind a small server-side
function (e.g. a Cloudflare Worker or Firebase Cloud Function) that
holds the key instead.

## Equipment assumption

Suggestions currently assume: dumbbells (multiple/adjustable), a bench,
and bodyweight exercises only.

## Data model

Workouts are stored as:
```json
{
  "id": 1234567890,
  "date": "2026-07-15T00:00:00.000Z",
  "duration": 30,
  "exercises": [
    {"name": "Dumbbell bench press", "sets": 3, "reps": 10, "weight": 35}
  ]
}
```

## Roadmap

- [ ] Move data storage off localStorage (private GitHub repo via Contents
      API, or Firebase) for cross-device sync
- [ ] Move Anthropic API key server-side before any public hosting
- [ ] Decide on final hosting (Firebase Hosting / Cloudflare Pages /
      Netlify / Vercel)
- [ ] Login gate so the hosted app isn't publicly accessible
