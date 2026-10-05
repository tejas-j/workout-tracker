# AI proxy (Cloudflare Worker)

Serves AI workout suggestions from Gemini without exposing the API key to browsers,
and enforces daily limits on the server.

| Tier | Who | Default daily limit |
|---|---|---|
| `owner` | Verified Google accounts listed in the `OWNER_EMAILS` secret | 100 |
| `member` | Any other verified, signed-in Google account | 20 each, 150 in total |
| `public` | Signed-out visitors and guest accounts, counted per IP (stored hashed) | 5 per IP, 50 in total |

Signed-in users are identified by verifying their Firebase ID token (signature, issuer,
audience, expiry). Requests are only accepted from `ALLOWED_ORIGINS`, prompt and schema
sizes are capped, and the model and output limit are chosen by the Worker. Days reset at
midnight Pacific time, when Gemini's free-tier quota resets. When a limit
is reached the app falls back to its built-in exercise library.

## Configuration

| Name | Kind | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | secret | Gemini API key from Google AI Studio |
| `OWNER_EMAILS` | secret | Comma-separated emails for the owner tier |
| `USAGE_COUNTER` | Durable Object | Exact daily usage counters, cleared when the day changes |
| `GEMINI_MODEL` | var | Model ID, default `gemini-3.5-flash-lite` |
| `LIMIT_OWNER`, `LIMIT_MEMBER`, `LIMIT_MEMBER_TOTAL`, `LIMIT_PUBLIC_PER_IP`, `LIMIT_PUBLIC_TOTAL` | vars | Daily limits |
| `ALLOWED_ORIGINS`, `FIREBASE_PROJECT_ID` | vars | Allowed sites and the Firebase project to trust |

Secrets are set with Wrangler and are never stored in the repository.

## Setup

1. **Create a Gemini API key** in [Google AI Studio](https://aistudio.google.com/apikey).
   Use a Google Cloud project with no billing account linked so usage stays on the free
   tier. In the Google Cloud console, restrict the key to the *Generative Language API*.
2. **Install and sign in to Cloudflare:**
   ```bash
   cd worker
   npm install
   npx wrangler login
   ```
3. **Set the secrets** (each command prompts for the value):
   ```bash
   npx wrangler secret put GEMINI_API_KEY
   npx wrangler secret put OWNER_EMAILS
   ```
4. **Deploy** (this also creates the usage-counter Durable Object):
   ```bash
   npx wrangler deploy
   ```
   Then set `AI_PROXY_URL` in `index.html` to the Worker URL it prints.

## Tests

```bash
npm test
```

Runs the tier, pool, day-rollover, concurrency, auth, validation and upstream error tests
locally, with no network calls. `npm run dev` runs the Worker in the local Workers runtime.
