// Holds the Anthropic API key so the browser never sees it. Only signed-in
// (non-guest) Firebase users whose email is in ALLOWED_EMAILS can use it.
import Anthropic from '@anthropic-ai/sdk';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const MODEL = 'claude-haiku-4-5';
const MAX_SYSTEM_CHARS = 4000;
const MAX_PROMPT_CHARS = 6000;
const FIREBASE_JWKS = createRemoteJWKSet(new URL(
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));

const list = s => (s || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);

function json(body, status, cors) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors } });
}

async function verifyFirebaseToken(token, projectId, keys) {
  const { payload } = await jwtVerify(token, keys, {
    issuer: `https://securetoken.google.com/${projectId}`,
    audience: projectId
  });
  return payload;
}

// deps lets tests swap in a local key set and a fake Anthropic client.
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

  // 1. Who is calling?
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  let claims;
  try {
    claims = await verifyFirebaseToken(token, env.FIREBASE_PROJECT_ID, deps.keys || FIREBASE_JWKS);
  } catch {
    return json({ error: 'Not signed in' }, 401, cors);
  }
  const email = String(claims.email || '').toLowerCase();
  const allowed = claims.firebase?.sign_in_provider !== 'anonymous' && claims.email_verified === true &&
    list(env.ALLOWED_EMAILS).includes(email);
  if (!allowed) return json({ error: 'AI suggestions are not enabled for this account' }, 403, cors);

  // 2. Validate the request body.
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, cors); }
  const { system, prompt } = body || {};
  if (typeof system !== 'string' || typeof prompt !== 'string' || !prompt ||
      system.length > MAX_SYSTEM_CHARS || prompt.length > MAX_PROMPT_CHARS) {
    return json({ error: 'Invalid request' }, 400, cors);
  }

  // 3. Per-user daily limit (only if the KV namespace is bound).
  if (env.USAGE) {
    const key = `${claims.sub}:${new Date().toISOString().slice(0, 10)}`;
    const used = parseInt(await env.USAGE.get(key)) || 0;
    if (used >= (parseInt(env.DAILY_LIMIT) || 25)) return json({ error: 'Daily AI limit reached' }, 429, cors);
    await env.USAGE.put(key, String(used + 1), { expirationTtl: 60 * 60 * 48 });
  }

  // 4. Call Claude with server-chosen model and output cap.
  const client = deps.client || new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system,
      messages: [{ role: 'user', content: prompt }]
    });
    if (response.stop_reason === 'refusal') return json({ error: 'Request was declined' }, 422, cors);
    const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
    return json({ text }, 200, cors);
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) return json({ error: 'AI is busy, try again shortly' }, 503, cors);
    if (error instanceof Anthropic.AuthenticationError) return json({ error: 'Proxy API key is invalid' }, 502, cors);
    if (error instanceof Anthropic.APIError) return json({ error: `Upstream error ${error.status}` }, 502, cors);
    return json({ error: 'Upstream request failed' }, 502, cors);
  }
}

export default { fetch: (request, env) => handle(request, env) };
