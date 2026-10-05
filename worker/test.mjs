// Local tests: real token verification against a locally generated key,
// an in-memory KV store and a fake Gemini endpoint. Makes no network calls.
import { generateKeyPair, SignJWT, createLocalJWKSet, exportJWK } from 'jose';
import { handle } from './src/handler.js';
import { UsageLedger } from './src/usage.js';

const PROJECT = 'workout-tracker-67216';
const ORIGIN = 'https://train.tejasrj.io';
const { publicKey, privateKey } = await generateKeyPair('RS256');
const keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' }] });

const token = (claims, opts = {}) => new SignJWT({
  email_verified: true, firebase: { sign_in_provider: 'google.com' }, ...claims
}).setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuedAt().setExpirationTime(opts.exp || '1h')
  .setIssuer(opts.iss || `https://securetoken.google.com/${PROJECT}`).setAudience(PROJECT)
  .setSubject(claims.sub || 'u1').sign(privateKey);

// In-memory stand-in for Durable Object storage, driving the real UsageLedger logic.
function fakeCounterNamespace() {
  const store = new Map();
  const storage = {
    get: async k => store.get(k),
    put: async (k, v) => { if (typeof k === 'object') Object.entries(k).forEach(([a, b]) => store.set(a, b)); else store.set(k, v); },
    deleteAll: async () => store.clear()
  };
  const instance = new UsageLedger(storage);
  return { idFromName: name => name, get: () => instance, store };
}

function makeEnv(overrides = {}) {
  return {
    FIREBASE_PROJECT_ID: PROJECT, ALLOWED_ORIGINS: ORIGIN, OWNER_EMAILS: 'Owner@x.com, partner@x.com',
    GEMINI_API_KEY: 'test-key', LIMIT_OWNER: '3', LIMIT_MEMBER: '2', LIMIT_MEMBER_TOTAL: '3', LIMIT_PUBLIC_PER_IP: '2', LIMIT_PUBLIC_TOTAL: '3',
    USAGE_COUNTER: fakeCounterNamespace(),
    ...overrides
  };
}

let geminiCalls = [];
let geminiReply = () => new Response(JSON.stringify({
  candidates: [{ content: { parts: [{ text: '{"focus":"Upper body","exercises":[]}' }] }, finishReason: 'STOP' }]
}), { status: 200 });
const fakeFetch = async (url, init) => { geminiCalls.push({ url, init }); return geminiReply(); };

const req = ({ tok, ip = '1.1.1.1', origin = ORIGIN, method = 'POST', body = { system: 's', prompt: 'p' } } = {}) => {
  const headers = { Origin: origin, 'CF-Connecting-IP': ip, 'Content-Type': 'application/json' };
  if (tok) headers.Authorization = `Bearer ${tok}`;
  return new Request('https://worker/', { method, headers, body: method === 'POST' ? JSON.stringify(body) : undefined });
};

let failures = 0;
async function check(name, request, expectStatus, env, expectBody, now) {
  const res = await handle(request, env, { keys, fetch: fakeFetch, now: now && (() => new Date(now)) });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  const ok = res.status === expectStatus && (!expectBody || Object.entries(expectBody).every(([k, v]) => body?.[k] === v));
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${res.status} ${text}`);
  if (!ok) failures++;
  return body;
}

// --- request validation and origin ---
let env = makeEnv();
await check('preflight from allowed origin', req({ method: 'OPTIONS' }), 204, env);
await check('preflight from other origin', req({ method: 'OPTIONS', origin: 'https://evil.com' }), 403, env);
await check('POST from other origin', req({ origin: 'https://evil.com' }), 403, env);
await check('missing prompt', req({ body: { system: 's' } }), 400, env);
await check('oversized prompt', req({ body: { system: 's', prompt: 'x'.repeat(7000) } }), 400, env);
await check('oversized schema', req({ body: { system: 's', prompt: 'p', schema: { d: 'x'.repeat(5000) } } }), 400, env);
await check('not configured (no counter)', req(), 503, makeEnv({ USAGE_COUNTER: undefined }));
await check('not configured (no key)', req(), 503, makeEnv({ GEMINI_API_KEY: undefined }));

// --- auth ---
await check('garbage token', req({ tok: 'abc.def.ghi' }), 401, env);
await check('expired token', req({ tok: await token({ email: 'owner@x.com' }, { exp: '-1m' }) }), 401, env);
await check('token for another project', req({ tok: await token({ email: 'owner@x.com' }, { iss: 'https://securetoken.google.com/other' }) }), 401, env);

// --- tiers ---
env = makeEnv();
const owner = await token({ email: 'OWNER@x.com', sub: 'o1' });
await check('owner 1/3', req({ tok: owner }), 200, env, { tier: 'owner', remaining: 2 });
await check('owner 2/3', req({ tok: owner }), 200, env, { tier: 'owner', remaining: 1 });
await check('owner 3/3', req({ tok: owner }), 200, env, { tier: 'owner', remaining: 0 });
await check('owner over limit', req({ tok: owner }), 429, env, { tier: 'owner' });
await check('second owner has own quota', req({ tok: await token({ email: 'partner@x.com', sub: 'o2' }) }), 200, env, { tier: 'owner' });

const member = await token({ email: 'friend@x.com', sub: 'm1' });
await check('member 1/2', req({ tok: member }), 200, env, { tier: 'member', remaining: 1 });
await check('member 2/2', req({ tok: member }), 200, env, { tier: 'member', remaining: 0 });
await check('member over limit', req({ tok: member }), 429, env, { tier: 'member' });
const member2 = await token({ email: 'other@x.com', sub: 'm2' });
await check('member pool: second member uses last slot', req({ tok: member2 }), 200, env, { tier: 'member', remaining: 1 });
await check('member pool exhausted for second member', req({ tok: member2 }), 429, env, { tier: 'member' });
await check('member pool does not block owners', req({ tok: owner }), 429, env, { tier: 'owner' }); // owner already at 3/3
await check('member pool does not block other owner', req({ tok: await token({ email: 'partner@x.com', sub: 'o2' }) }), 200, env, { tier: 'owner' });
await check('unverified email is public', req({ tok: await token({ email: 'owner@x.com', email_verified: false, sub: 'x' }), ip: '9.9.9.9' }), 200, env, { tier: 'public' });

env = makeEnv();
await check('public ip A 1/2', req({ ip: '2.2.2.2' }), 200, env, { tier: 'public', remaining: 1 });
await check('guest token counts as public ip A 2/2', req({ ip: '2.2.2.2', tok: await token({ firebase: { sign_in_provider: 'anonymous' }, sub: 'g1' }) }), 200, env, { tier: 'public', remaining: 0 });
await check('public ip A over limit', req({ ip: '2.2.2.2' }), 429, env, { tier: 'public' });
await check('public ip B uses last pool slot', req({ ip: '3.3.3.3' }), 200, env, { tier: 'public' });
await check('public pool exhausted for ip C', req({ ip: '4.4.4.4' }), 429, env, { tier: 'public' });
await check('pool does not block owners', req({ tok: owner, ip: '4.4.4.4' }), 200, env, { tier: 'owner' });
const storedKeys = [...env.USAGE_COUNTER.store.keys()].join(' ');
console.log(`${/2\.2\.2\.2|3\.3\.3\.3/.test(storedKeys) ? 'FAIL' : 'PASS'} raw IPs are not stored`);
if (/2\.2\.2\.2|3\.3\.3\.3/.test(storedKeys)) failures++;

// --- days roll over at midnight Pacific time ---
env = makeEnv();
const lateOct5 = '2026-10-06T06:59:00Z';   // 23:59 PDT on Oct 5
const earlyUtcOct6 = '2026-10-06T01:00:00Z'; // already Oct 6 in UTC, still Oct 5 in PDT
const justAfterMidnight = '2026-10-06T07:01:00Z'; // 00:01 PDT on Oct 6
await check('Pacific: use 1/2 on Oct 5', req({ ip: '7.7.7.7' }), 200, env, { remaining: 1 }, earlyUtcOct6);
await check('Pacific: use 2/2 on Oct 5', req({ ip: '7.7.7.7' }), 200, env, { remaining: 0 }, lateOct5);
await check('Pacific: still Oct 5 after UTC midnight', req({ ip: '7.7.7.7' }), 429, env, null, earlyUtcOct6);
await check('Pacific: resets after Pacific midnight', req({ ip: '7.7.7.7' }), 200, env, { remaining: 1 }, justAfterMidnight);
const winter = makeEnv();
await check('Pacific (PST, winter): 23:59 PST is still Dec 1', req({ ip: '8.8.8.8' }), 200, winter, null, '2026-12-02T07:59:00Z');
console.log(`${winter.USAGE_COUNTER.store.get('day') === '2026-12-01' ? 'PASS' : 'FAIL'} winter counter day is Dec 1`);
if (winter.USAGE_COUNTER.store.get('day') !== '2026-12-01') failures++;

// --- counter atomicity: concurrent requests never exceed a limit ---
env = makeEnv({ LIMIT_PUBLIC_PER_IP: '3', LIMIT_PUBLIC_TOTAL: '100' });
const burst = await Promise.all(Array.from({ length: 10 }, () => handle(req({ ip: '6.6.6.6' }), env, { keys, fetch: fakeFetch })));
const okCount = burst.filter(r => r.status === 200).length;
console.log(`${okCount === 3 ? 'PASS' : 'FAIL'} 10 concurrent requests, limit 3: ${okCount} allowed`);
if (okCount !== 3) failures++;
// old day's counters are cleared at rollover
await check('rollover clears yesterday', req({ ip: '6.6.6.6' }), 200, env, { remaining: 2 }, '2099-01-01T12:00:00Z');
const st = env.USAGE_COUNTER.store;
const reset = st.get('day') === '2099-01-01' && st.get('n:public-pool') === 1 && st.size === 3;
console.log(`${reset ? 'PASS' : 'FAIL'} counters reset at rollover (day=${st.get('day')}, pool=${st.get('n:public-pool')}, keys=${st.size})`);
if (!reset) failures++;

// --- Gemini request and response handling ---
env = makeEnv({ LIMIT_PUBLIC_PER_IP: '50', LIMIT_PUBLIC_TOTAL: '50' });
geminiCalls = [];
const schema = { type: 'object', properties: { focus: { type: 'string' } } };
await check('passes schema through', req({ body: { system: 'sys', prompt: 'hello', schema } }), 200, env);
const call = geminiCalls[0];
const sent = JSON.parse(call.init.body);
const shapeOk = call.url.endsWith('/gemini-3.5-flash-lite:generateContent') && !call.url.includes('key=') &&
  call.init.headers['x-goog-api-key'] === 'test-key' && sent.systemInstruction.parts[0].text === 'sys' &&
  sent.contents[0].parts[0].text === 'hello' && sent.generationConfig.responseMimeType === 'application/json' &&
  JSON.stringify(sent.generationConfig.responseSchema) === JSON.stringify(schema);
console.log(`${shapeOk ? 'PASS' : 'FAIL'} Gemini request shape (key in header, not URL)`);
if (!shapeOk) failures++;

geminiReply = () => new Response('{}', { status: 429 });
await check('Gemini rate limited', req(), 503, env);
geminiReply = () => new Response('{}', { status: 500 });
await check('Gemini server error', req(), 502, env);
geminiReply = () => new Response(JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' } }), { status: 200 });
await check('Gemini blocked prompt', req(), 422, env);
geminiReply = () => new Response(JSON.stringify({ candidates: [{ finishReason: 'SAFETY', content: { parts: [] } }] }), { status: 200 });
await check('Gemini safety stop', req(), 422, env);

console.log(failures ? `\n${failures} FAILED` : '\nAll tests passed');
process.exitCode = failures ? 1 : 0;
