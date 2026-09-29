import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { syncBuiltinESMExports } from 'node:module';
import { setImmediate } from 'node:timers/promises';
import { Client, Events, Status } from 'discord.js';

test('startup reconciliation preserves concurrent guild joins and departures', { timeout: 10000 }, async t => {
  const previousEnv = { ...process.env };
  Object.assign(process.env, { DISCORD_BOT_TOKEN: 'offline-test-token-with-at-least-30-characters',
    INTERNAL_RPC_SECRET: 'synthetic-internal-secret-for-tests-only', PUBLIC_URL: 'http://localhost:3102', STORE_URL: 'http://server:7102/internal/store' });
  const guilds = new Set(['departing', 'stale']);
  const reading = Promise.withResolvers();
  const release = Promise.withResolvers();
  const initialized = Promise.withResolvers();
  let client, handleRequest;
  t.mock.method(http, 'createServer', handler => { handleRequest = handler; return { listen() {}, close() {} }; });
  syncBuiltinESMExports();
  t.mock.method(Client.prototype, 'login', async function () { client = this; });
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'http://server:7102/internal/store');
    assert.equal(options.headers.Authorization, 'Bearer synthetic-internal-secret-for-tests-only');
    const { method, args } = JSON.parse(options.body);
    if (method === 'allGuilds') { reading.resolve(); await release.promise; }
    if (method === 'registerGuild') guilds.add(args[0]);
    if (method === 'forgetGuild') guilds.delete(args[0]);
    return Response.json({ result: method === 'allGuilds' ? [...guilds].map(id => ({ id })) : null });
  });
  t.after(() => {
    process.emit('SIGTERM');
    for (const key of ['DISCORD_BOT_TOKEN', 'INTERNAL_RPC_SECRET', 'PUBLIC_URL', 'STORE_URL']) {
      if (previousEnv[key] === undefined) delete process.env[key]; else process.env[key] = previousEnv[key];
    }
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  await import('../apps/bot/src/index.ts');
  client.ws.status = Status.Ready;
  client.ws.shards.set(0, { status: Status.Ready });
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
  for (const authorization of [undefined, 'Bearer wrong', 'Bearer synthetic-internal-secret-for-tests-only']) {
    const result = { status: 200, body: null };
    const request = { url: '/rpc', method: 'POST', headers: { authorization },
      async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify({ method: 'health', args: [] })); } };
    const response = { setHeader() {}, writeHead(status) { result.status = status; return this; }, end(body) { result.body = JSON.parse(body); } };
    await handleRequest(request, response);
    assert.equal(result.status, authorization?.endsWith('tests-only') ? 200 : 401);
    if (result.status === 200) assert.deepEqual(result.body, { result: { connected: true } });
  }
});

for (const failure of ['registerGuild', 'forgetGuild', 'gatewayReidentified', 'gatewayDisconnected']) {
  test(`${failure} stops the bot for reconciliation on restart`, { timeout: 10000 }, async t => {
    const previousEnv = { ...process.env };
    const previousExitCode = process.exitCode;
    const previousSignals = new Map(['SIGTERM', 'SIGINT'].map(signal => [signal, new Set(process.listeners(signal))]));
    Object.assign(process.env, { DISCORD_BOT_TOKEN: 'offline-test-token-with-at-least-30-characters',
      PUBLIC_URL: 'http://localhost:3102', STORE_URL: 'http://jev.internal/store' });
    const initialized = Promise.withResolvers();
    const stopped = Promise.withResolvers();
    const writes = [];
    let client, handleRequest;
    let closed = false;
    t.mock.method(http, 'createServer', handler => { handleRequest = handler; return { listen() {}, close() { closed = true; } }; });
    syncBuiltinESMExports();
    t.mock.method(Client.prototype, 'login', async function () { client = this; });
    if (failure === 'gatewayDisconnected') t.mock.timers.enable({ apis: ['Date', 'setInterval'], now: 1000 });
    const destroy = Client.prototype.destroy;
    t.mock.method(Client.prototype, 'destroy', async function () { await destroy.call(this); stopped.resolve(); });
    t.mock.method(globalThis, 'fetch', async (url, options) => {
      assert.equal(url, 'http://jev.internal/store');
      const input = JSON.parse(options.body);
      if (input.method === failure) { writes.push(input.args[0]); throw new Error('store unavailable'); }
      return Response.json({ result: input.method === 'allGuilds' ? [] : null });
    });
    t.after(async () => {
      process.emit('SIGTERM');
      await stopped.promise;
      for (const key of ['DISCORD_BOT_TOKEN', 'PUBLIC_URL', 'STORE_URL']) {
        if (previousEnv[key] === undefined) delete process.env[key]; else process.env[key] = previousEnv[key];
      }
      process.exitCode = previousExitCode;
      for (const [signal, listeners] of previousSignals) {
        for (const listener of process.listeners(signal)) if (!listeners.has(listener)) process.removeListener(signal, listener);
      }
      t.mock.restoreAll(); t.mock.timers.reset(); syncBuiltinESMExports();
    });
    await import(`../apps/bot/src/index.ts?failure=${failure}`);
    client.ws.status = Status.Ready;
    client.ws.shards.set(0, { status: Status.Ready });
    client.application = { commands: { create: async () => initialized.resolve() } };
    client.emit(Events.ShardReady, 0);
    client.emit(Events.ClientReady, client);
    await initialized.promise; await setImmediate();
    let health;
    const response = { setHeader() {}, end(body) { health = JSON.parse(body); } };
    await handleRequest({ url: '/healthz' }, response);
    assert.equal(health.connected, true);
    client.emit(Events.ShardResume, 0, 1);
    assert.equal(closed, false);
    if (failure === 'gatewayReidentified') client.emit(Events.ShardReady, 0);
    else if (failure === 'gatewayDisconnected') {
      client.ws.shards.get(0).status = Status.Resuming;
      await handleRequest({ url: '/healthz' }, response);
      assert.equal(health.connected, false);
      t.mock.timers.tick(210001);
    } else {
      const event = failure === 'registerGuild' ? Events.GuildCreate : Events.GuildDelete;
      client.emit(event, { id: 'failed-guild' });
      client.emit(event, { id: 'queued-guild' });
    }
    await stopped.promise; await setImmediate();
    await handleRequest({ url: '/healthz' }, response);
    assert.equal(health.connected, false);
    assert.equal(closed, true);
    assert.equal(process.exitCode, 1);
    assert.deepEqual(writes, failure.startsWith('gateway') ? [] : ['failed-guild']);
  });
}
