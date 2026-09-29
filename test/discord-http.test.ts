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
