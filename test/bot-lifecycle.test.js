import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { syncBuiltinESMExports } from 'node:module';
import { setImmediate } from 'node:timers/promises';
import { Client, Events } from 'discord.js';

test('startup reconciliation preserves concurrent guild joins and departures', { timeout: 10000 }, async t => {
  const previousEnv = { ...process.env };
  Object.assign(process.env, { DISCORD_BOT_TOKEN: 'offline-test-token-with-at-least-30-characters',
    TYPESAFE_API_KEY: 'offline-test-key', PUBLIC_URL: 'http://localhost:3102', STORE_URL: 'http://jev.internal/store' });
  const guilds = new Set(['departing', 'stale']);
  const reading = Promise.withResolvers();
  const release = Promise.withResolvers();
  const initialized = Promise.withResolvers();
  let client;
  t.mock.method(http, 'createServer', () => ({ listen() {}, close() {} }));
  syncBuiltinESMExports();
  t.mock.method(Client.prototype, 'login', async function () { client = this; });
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'http://jev.internal/store');
    const { method, args } = JSON.parse(options.body);
    if (method === 'allGuilds') { reading.resolve(); await release.promise; }
    if (method === 'registerGuild') guilds.add(args[0]);
    if (method === 'forgetGuild') guilds.delete(args[0]);
    return Response.json({ result: method === 'allGuilds' ? [...guilds].map(id => ({ id })) : null });
  });
  t.after(() => {
    process.emit('SIGTERM');
    for (const key of ['DISCORD_BOT_TOKEN', 'TYPESAFE_API_KEY', 'PUBLIC_URL', 'STORE_URL']) {
      if (previousEnv[key] === undefined) delete process.env[key]; else process.env[key] = previousEnv[key];
    }
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  await import('../apps/bot/src/index.ts');
  client.guilds.cache.set('departing', { id: 'departing' });
  client.application = { commands: { create: async () => initialized.resolve() } };
  client.emit(Events.ClientReady, client);
  await reading.promise;
  client.guilds.cache.set('joined', { id: 'joined' });
  client.emit(Events.GuildCreate, { id: 'joined' });
  client.guilds.cache.delete('departing');
  client.emit(Events.GuildDelete, { id: 'departing' });
  await setImmediate();
  release.resolve();
  await initialized.promise;
  await setImmediate();
  assert.deepEqual([...guilds], ['joined']);
});

for (const method of ['registerGuild', 'forgetGuild']) {
  test(`${method} failure stops the bot for reconciliation on restart`, { timeout: 10000 }, async t => {
    const previousEnv = { ...process.env };
    const previousExitCode = process.exitCode;
    const previousSignals = new Map(['SIGTERM', 'SIGINT'].map(signal => [signal, new Set(process.listeners(signal))]));
    Object.assign(process.env, { DISCORD_BOT_TOKEN: 'offline-test-token-with-at-least-30-characters',
      TYPESAFE_API_KEY: 'offline-test-key', PUBLIC_URL: 'http://localhost:3102', STORE_URL: 'http://jev.internal/store' });
    const initialized = Promise.withResolvers();
    const stopped = Promise.withResolvers();
    const writes = [];
    let client, handleRequest;
    let closed = false;
    t.mock.method(http, 'createServer', handler => { handleRequest = handler; return { listen() {}, close() { closed = true; } }; });
    syncBuiltinESMExports();
    t.mock.method(Client.prototype, 'login', async function () { client = this; });
    t.mock.method(Client.prototype, 'isReady', () => true);
    const destroy = Client.prototype.destroy;
    t.mock.method(Client.prototype, 'destroy', async function () { await destroy.call(this); stopped.resolve(); });
    t.mock.method(globalThis, 'fetch', async (url, options) => {
      assert.equal(url, 'http://jev.internal/store');
      const input = JSON.parse(options.body);
      if (input.method === method) { writes.push(input.args[0]); throw new Error('store unavailable'); }
      return Response.json({ result: input.method === 'allGuilds' ? [] : null });
    });
    t.after(async () => {
      process.emit('SIGTERM');
      await stopped.promise;
      for (const key of ['DISCORD_BOT_TOKEN', 'TYPESAFE_API_KEY', 'PUBLIC_URL', 'STORE_URL']) {
        if (previousEnv[key] === undefined) delete process.env[key]; else process.env[key] = previousEnv[key];
      }
      process.exitCode = previousExitCode;
      for (const [signal, listeners] of previousSignals) {
        for (const listener of process.listeners(signal)) if (!listeners.has(listener)) process.removeListener(signal, listener);
      }
      t.mock.restoreAll(); syncBuiltinESMExports();
    });
    await import(`../apps/bot/src/index.ts?failure=${method}`);
    client.application = { commands: { create: async () => initialized.resolve() } };
    client.emit(Events.ClientReady, client);
    await initialized.promise; await setImmediate();
    let health;
    const response = { setHeader() {}, end(body) { health = JSON.parse(body); } };
    await handleRequest({ url: '/healthz' }, response);
    assert.equal(health.connected, true);
    const event = method === 'registerGuild' ? Events.GuildCreate : Events.GuildDelete;
    client.emit(event, { id: 'failed-guild' });
    client.emit(event, { id: 'queued-guild' });
    await stopped.promise; await setImmediate();
    await handleRequest({ url: '/healthz' }, response);
    assert.equal(health.connected, false);
    assert.equal(closed, true);
    assert.equal(process.exitCode, 1);
    assert.deepEqual(writes, ['failed-guild']);
  });
}
