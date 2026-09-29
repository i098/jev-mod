import test from 'node:test';
import assert from 'node:assert/strict';
import { listDiscordGuilds } from '../apps/server/src/app.ts';

test('Discord guild requests identify Jev-Mod and return only manageable servers', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    assert.equal(new URL(request.url).pathname, '/api/v10/users/@me/guilds');
    assert.equal(request.headers.get('Authorization'), 'Bearer synthetic-oauth-token');
    assert.match(request.headers.get('User-Agent') ?? '', /^DiscordBot \(https:\/\/github\.com\/undeemed\/jev-mod, \d+\.\d+\.\d+\)$/);
    return Response.json([
      { id: '100000000000000001', name: 'Managed sample server', permissions: '32' },
      { id: '100000000000000002', name: 'Other sample server', permissions: '0' },
    ]);
  };
  assert.deepEqual((await listDiscordGuilds('synthetic-oauth-token')).map(guild => guild.id), ['100000000000000001']);
});

test('Discord failures expose only status in logs and a safe dashboard error', async t => {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  t.after(() => { globalThis.fetch = originalFetch; console.warn = originalWarn; });
  const warnings: unknown[][] = [];
  console.warn = (...args) => { warnings.push(args); };
  for (const status of [401, 403, 429, 500]) {
    globalThis.fetch = async () => new Response('Synthetic private provider details', { status });
    await assert.rejects(listDiscordGuilds('synthetic-oauth-token'), {
      message: 'Discord is unavailable. Sign in again or try shortly.', status: status === 401 ? 401 : 503,
    });
    assert.deepEqual(warnings.pop(), [JSON.stringify({ event: 'discord_guilds_failed', status })]);
  }
});
