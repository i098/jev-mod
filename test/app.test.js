import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/app.js';
import { memoryStore, demoDiscord, demoGuilds } from '../src/demo-data.js';
import { defaultSettings } from '../src/policy.js';

test('HTTP flow enforces sessions, CSRF, server isolation, optimistic updates, and scoped case review', async t => {
  const store = memoryStore();
  const config = { NODE_ENV: 'development', TRUST_PROXY: 0, PUBLIC_URL: 'http://localhost:7102', SESSION_SECRET: 'test-secret-'.repeat(5), DISCORD_CLIENT_ID: '100000000000000001' };
  const app = createApp({ config, store, discord: demoDiscord(), classify: async () => ({ matches: [], scores: [], model: 'test' }), health: () => ({ connected: false }) });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const origin = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${origin}/api/guilds`)).status, 401);
  assert.equal((await fetch(`${origin}/auth/callback?state=wrong&code=bad`)).status, 400);

  const preview = createApp({ config, store, discord: demoDiscord(), classify: async () => ({ matches: [], scores: [], model: 'test' }), health: () => ({}),
    demo: { user: { id: '600000000000000001' }, guilds: demoGuilds } });
  const previewServer = preview.listen(0, '127.0.0.1');
  await once(previewServer, 'listening');
  t.after(() => previewServer.close());
  const base = `http://127.0.0.1:${previewServer.address().port}`;
  const session = await fetch(`${base}/api/session`);
  const cookie = session.headers.get('set-cookie').split(';')[0];
  const csrf = (await session.json()).csrf;
  const headers = { Cookie: cookie, Origin: config.PUBLIC_URL, 'Content-Type': 'application/json', 'x-csrf-token': csrf };
  const path = `/api/guilds/${demoGuilds[0].id}`;
  assert.equal((await fetch(`${base}/api/guilds/999999999999999999`, { headers })).status, 403);
  assert.equal((await fetch(`${base}${path}/settings`, { method: 'PUT', headers: { ...headers, Origin: 'https://evil.example' }, body: '{}' })).status, 403);
  const body = JSON.stringify({ settings: { ...defaultSettings(), mode: 'protect' }, version: 0 });
  assert.equal((await fetch(`${base}${path}/settings`, { method: 'PUT', headers, body })).status, 200);
  assert.equal((await fetch(`${base}${path}/settings`, { method: 'PUT', headers, body })).status, 409);
  const other = await (await fetch(`${base}/api/guilds/${demoGuilds[1].id}`, { headers })).json();
  assert.equal(other.settings.mode, 'monitor');
  const id = await store.addCase({ guildId: demoGuilds[1].id, messageId: 'm', policyVersion: 0, messageHash: 'hash', matches: [], outcome: 'monitored' });
  assert.equal((await fetch(`${base}${path}/cases/${id}/review`, { method: 'POST', headers, body: JSON.stringify({ action: 'delete' }) })).status, 404);
});

test('concurrent OAuth callbacks consume one state only once', async t => {
  let tokenCalls = 0;
  const app = createApp({ config: { NODE_ENV: 'development', TRUST_PROXY: 0, PUBLIC_URL: 'http://localhost:7102',
    SESSION_SECRET: 'oauth-test-secret'.repeat(3), DISCORD_CLIENT_ID: '100000000000000001', DISCORD_CLIENT_SECRET: 'sample-secret' },
  store: memoryStore(), discord: demoDiscord(), classify: async () => ({}), health: () => ({}),
  fetcher: async url => {
    if (url.endsWith('/oauth2/token')) { tokenCalls++; return Response.json({ access_token: 'sample-provider-token', expires_in: 3600 }); }
    return Response.json({ id: '600000000000000001', username: 'test' });
  } });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(`${base}/auth/login`, { redirect: 'manual' });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const state = new URL(login.headers.get('location')).searchParams.get('state');
  const callbacks = await Promise.all([1, 2].map(() => fetch(`${base}/auth/callback?state=${state}&code=sample-code`, { headers: { Cookie: cookie }, redirect: 'manual' })));
  assert.deepEqual(callbacks.map(response => response.status).sort(), [302, 400]);
  assert.equal(tokenCalls, 1);
});
