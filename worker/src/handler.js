// AI proxy for the app. Holds the Gemini API key so browsers never see it and
// enforces daily limits per tier on the server:
//   owner:  verified Google accounts listed in the OWNER_EMAILS secret
//   member: any other verified, signed-in Google account, each limited plus a shared daily pool
//   public: everyone else (signed out or guest), counted per IP plus a shared daily pool
// Days roll over at midnight Pacific time, matching when Gemini's free-tier quota resets.
import { createRemoteJWKSet, jwtVerify } from 'jose';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_MODEL = 'gemini-3.5-flash-lite';
const MAX_SYSTEM_CHARS = 4000;
const MAX_PROMPT_CHARS = 6000;
const MAX_SCHEMA_CHARS = 4000;
const FIREBASE_JWKS = createRemoteJWKSet(new URL(
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));

const list = s => (s || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
const int = (v, d) => (Number.isFinite(parseInt(v)) ? parseInt(v) : d);

function json(body, status, cors) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors } });
}

async function sha256(text) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Returns { tier, id } for the caller, or null if a token was sent but is invalid.
async function identify(request, env, keys) {
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (token) {
    let claims;
    try {
      ({ payload: claims } = await jwtVerify(token, keys, {
        issuer: `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`,
        audience: env.FIREBASE_PROJECT_ID
      }));
    } catch {
      return null;
    }
    const google = claims.firebase?.sign_in_provider !== 'anonymous' && claims.email_verified === true && claims.email;
    if (google) {
      const tier = list(env.OWNER_EMAILS).includes(String(claims.email).toLowerCase()) ? 'owner' : 'member';
      return { tier, id: `uid:${claims.sub}` };
    }
    // guest (anonymous) accounts fall through to the public tier
  }
  // Hash the IP so raw addresses are never stored.
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  return { tier: 'public', id: `ip:${await sha256(ip)}` };
}

// "YYYY-MM-DD" for the current day in Pacific time.
const pacificDay = now => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit'
}).format(now);

// Daily limit checks for one caller: their own counter, plus a shared pool for
// members and the public. Owners are only limited individually.
function limitsFor(who, env) {
  const own = { owner: int(env.LIMIT_OWNER, 100), member: int(env.LIMIT_MEMBER, 20), public: int(env.LIMIT_PUBLIC_PER_IP, 5) }[who.tier];
  const checks = [{ key: who.id, limit: own }];
  const pool = { member: int(env.LIMIT_MEMBER_TOTAL, 150), public: int(env.LIMIT_PUBLIC_TOTAL, 50) }[who.tier];
  if (pool !== undefined) checks.push({ key: `${who.tier}-pool`, limit: pool });
  return { own, checks };
}

// deps lets tests swap in a local key set, a fake fetch and a fixed clock.
export async function handle(request, env, deps = {}) {
  const origin = request.headers.get('Origin') || '';
  const allowedOrigin = list(env.ALLOWED_ORIGINS).includes(origin.toLowerCase()) ? origin : '';
  const cors = allowedOrigin ? {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  } : {};

  if (request.method === 'OPTIONS') return new Response(null, { status: allowedOrigin ? 204 : 403, headers: cors });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, cors);
  if (!allowedOrigin) return json({ error: 'Origin not allowed' }, 403, cors);
  if (!env.USAGE_COUNTER || !env.GEMINI_API_KEY) return json({ error: 'AI is not configured' }, 503, cors);

  // 1. Validate the body before spending any quota.
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, cors); }
  const { system, prompt, schema } = body || {};
  if (typeof system !== 'string' || typeof prompt !== 'string' || !prompt ||
      system.length > MAX_SYSTEM_CHARS || prompt.length > MAX_PROMPT_CHARS ||
      (schema !== undefined && (typeof schema !== 'object' || schema === null ||
        JSON.stringify(schema).length > MAX_SCHEMA_CHARS))) {
    return json({ error: 'Invalid request' }, 400, cors);
  }

  // 2. Who is calling, and do they have quota left today?
  const who = await identify(request, env, deps.keys || FIREBASE_JWKS);
  if (!who) return json({ error: 'Sign-in expired' }, 401, cors);
  const { own, checks } = limitsFor(who, env);
  const day = pacificDay(deps.now ? deps.now() : new Date());
  const counter = env.USAGE_COUNTER.get(env.USAGE_COUNTER.idFromName('global'));
  const usage = await counter.consume(day, checks);
  if (!usage.ok) return json({ error: 'Daily AI limit reached', tier: who.tier, limit: own }, 429, cors);
  const remaining = own - usage.used;

  // 3. Call Gemini with a server-chosen model and output cap.
  const generationConfig = { responseMimeType: 'application/json', maxOutputTokens: 2048, temperature: 0.9 };
  if (schema) generationConfig.responseSchema = schema;
  const doFetch = deps.fetch || fetch;
  let res;
  try {
    res = await doFetch(`${GEMINI_BASE}/${env.GEMINI_MODEL || DEFAULT_MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig
      })
    });
  } catch {
    return json({ error: 'Upstream request failed' }, 502, cors);
  }
  if (res.status === 429) return json({ error: 'AI is busy, try again shortly' }, 503, cors);
  if (!res.ok) return json({ error: `Upstream error ${res.status}` }, 502, cors);

  const data = await res.json().catch(() => ({}));
  const candidate = data.candidates?.[0];
  if (data.promptFeedback?.blockReason || !candidate || ['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST'].includes(candidate.finishReason)) {
    return json({ error: 'Request was declined' }, 422, cors);
  }
  const text = (candidate.content?.parts || []).map(p => p.text || '').join('');
  if (!text) return json({ error: 'Empty response' }, 502, cors);
  return json({ text, tier: who.tier, remaining }, 200, cors);
}

