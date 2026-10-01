// Local test: real token verification against a locally generated key, fake Claude client.
import { generateKeyPair, SignJWT, createLocalJWKSet, exportJWK } from 'jose';
import { handle } from './src/index.js';

const { publicKey, privateKey } = await generateKeyPair('RS256');
const keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' }] });
const PROJECT = 'workout-tracker-67216';
const token = (claims, opts = {}) => new SignJWT({ email_verified: true, firebase: { sign_in_provider: 'google.com' }, ...claims })
  .setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuedAt().setExpirationTime(opts.exp || '1h')
  .setIssuer(opts.iss || `https://securetoken.google.com/${PROJECT}`).setAudience(PROJECT).setSubject(claims.sub || 'u1').sign(privateKey);

const store = new Map();
const env = {
  FIREBASE_PROJECT_ID: PROJECT, ALLOWED_ORIGINS: 'https://train.tejasrj.io', ALLOWED_EMAILS: 'me@x.com, Wife@x.com', DAILY_LIMIT: '2',
  USAGE: { get: async k => store.get(k) ?? null, put: async (k, v) => store.set(k, v) }
};
let calls = [];
const client = { messages: { create: async p => { calls.push(p); return { stop_reason: 'end_turn', content: [{ type: 'text', text: '{"focus":"x","exercises":[]}' }] }; } } };
const req = (tok, body = { system: 's', prompt: 'p' }, origin = 'https://train.tejasrj.io', method = 'POST') =>
  new Request('https://w/', { method, headers: { Origin: origin, Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body: method === 'POST' ? JSON.stringify(body) : undefined });
const run = async (name, r, expect, e = env) => {
  const res = await handle(r, e, { keys, client });
  const ok = res.status === expect;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${res.status} ${await res.text()}`);
  if (!ok) process.exitCode = 1;
  return res;
};

const me = await token({ email: 'me@x.com', sub: 'u1' });
await run('preflight allowed origin', req('', null, 'https://train.tejasrj.io', 'OPTIONS'), 204);
await run('preflight other origin', req('', null, 'https://evil.com', 'OPTIONS'), 403);
await run('other origin POST', req(me, undefined, 'https://evil.com'), 403);
await run('no token', req(''), 401);
await run('garbage token', req('abc.def.ghi'), 401);
await run('expired token', req(await token({ email: 'me@x.com' }, { exp: '-1m' })), 401);
await run('wrong project issuer', req(await token({ email: 'me@x.com' }, { iss: 'https://securetoken.google.com/other' })), 401);
await run('email not allowlisted', req(await token({ email: 'stranger@x.com' })), 403);
await run('unverified email', req(await token({ email: 'me@x.com', email_verified: false })), 403);
await run('anonymous guest', req(await token({ email: 'me@x.com', firebase: { sign_in_provider: 'anonymous' } })), 403);
await run('oversized prompt', req(me, { system: 's', prompt: 'x'.repeat(7000) }), 400);
await run('missing prompt', req(me, { system: 's' }), 400);
await run('allowed user (case-insensitive email)', req(await token({ email: 'wife@X.com', sub: 'u2' })), 200);
await run('allowed user call 1', req(me), 200);
await run('allowed user call 2', req(me), 200);
await run('daily limit hit', req(me), 429);
console.log('model sent:', calls[0].model, '| max_tokens:', calls[0].max_tokens, '| claude calls:', calls.length);
