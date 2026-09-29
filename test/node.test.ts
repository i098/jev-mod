import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { openDatabase } from '../packages/db/src/node.ts';
import { createStore } from '../packages/db/src/index.ts';
import { guilds, budgets } from '../packages/db/src/schema/index.ts';
import { defaultSettings } from '../packages/core/src/policy.ts';
import { createAuth } from '../packages/auth/src/index.ts';
import { createBotApi, startNodeServer } from '../apps/server/src/node.ts';

const guild = '100000000000000001';
const second = '100000000000000002';
const environment = {
  PUBLIC_URL: 'http://127.0.0.1:7102', BETTER_AUTH_SECRET: 'synthetic-auth-secret-for-local-tests-only',
  DISCORD_CLIENT_ID: guild, DISCORD_CLIENT_SECRET: 'synthetic-discord-secret',
  INTERNAL_RPC_SECRET: 'synthetic-internal-secret-for-tests-only', KEY_ENCRYPTION_SECRET: 'a'.repeat(64),
  BOT_ENABLED: 'false' as const, PORT: '0',
};

test('SQLite preserves mapping, atomic batches, CAS, audit, foreign keys, budgets, and auth affected rows', async t => {
  const database = openDatabase(':memory:');
  t.after(database.close);
  const { db } = database;
  const store = createStore(db);
  assert.equal(await db.select().from(guilds).get(), undefined);
  assert.deepEqual(await db.insert(guilds).values({ id: guild, joined_at: 123 }).returning(), [{ id: guild, joined_at: 123 }]);
  assert.deepEqual(await db.select().from(guilds).get(), { id: guild, joined_at: 123 });
  await assert.rejects(db.batch([
    db.insert(guilds).values({ id: second, joined_at: 456 }),
    db.insert(guilds).values({ id: guild, joined_at: 789 }),
  ]));
  assert.deepEqual(await store.allGuilds(), [{ id: guild, joined_at: 123 }]);
  assert.deepEqual(await db.batch([
    db.insert(guilds).values({ id: second, joined_at: 456 }).returning({ id: guilds.id }),
    db.select().from(guilds),
  ]), [[{ id: second }], [{ id: guild, joined_at: 123 }, { id: second, joined_at: 456 }]]);
  const settings = { ...defaultSettings(), mode: 'protect' as const };
  const writes = await Promise.allSettled([
    store.saveSettings(guild, settings, 0, guild), store.saveSettings(guild, settings, 0, second),
  ]);
  assert.equal(writes.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal((await store.audit(guild)).length, 1);
  assert.equal((await store.getSettings(second)).settings.mode, 'monitor');
  assert.equal((await Promise.all(Array.from({ length: 5 }, () => store.consumeBudget('local-test', 2)))).filter(Boolean).length, 2);
  await store.forgetGuild(guild);
  assert.equal((await store.audit(guild)).length, 0);
  await assert.rejects(store.saveSettings(guild, settings, 0, second));

  const auth = createAuth(environment, db);
  const { adapter } = await auth.$context;
  const created = await adapter.create<{ id: string }>({ model: 'user', data: {
    name: 'Local test', email: 'local-test@example.invalid', emailVerified: false, createdAt: new Date(), updatedAt: new Date(),
  } });
  assert.equal(typeof created.id, 'string');
  assert.equal(await adapter.deleteMany({ model: 'user', where: [{ field: 'id', value: created.id }] }), 1);
  assert.equal(await adapter.deleteMany({ model: 'user', where: [{ field: 'id', value: created.id }] }), 0);
});

test('Node startup applies migrations, authenticates store RPC, ignores spoofed IP headers, and persists on restart', async t => {
  await mkdir('artifacts', { recursive: true });
  const folder = await mkdtemp('artifacts/node-test-');
  t.after(() => rm(folder, { recursive: true, force: true }));
  const config = { ...environment, DATABASE_PATH: join(folder, 'database.sqlite') };
  let runtime = await startNodeServer(config);
  t.after(() => runtime.close());
  const origin = () => {
    const address = runtime.server.address();
    assert.ok(address && typeof address !== 'string');
    return `http://127.0.0.1:${address.port}`;
  };
  const rpc = (method: string, args: unknown[], token = config.INTERNAL_RPC_SECRET) => fetch(`${origin()}/internal/store`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ method, args }),
  });
  assert.equal((await fetch(`${origin()}/healthz`)).status, 200);
  assert.equal((await fetch(`${origin()}/internal/store`, { method: 'POST', body: '{}' })).status, 401);
  assert.equal((await rpc('registerGuild', [guild], 'wrong-secret')).status, 401);
  assert.equal((await rpc('query', ['SELECT 1'])).status, 400);
  assert.equal((await rpc('registerGuild', [guild])).status, 200);
  for (const address of ['198.51.100.1', '198.51.100.2']) {
    const response = await fetch(`${origin()}/api/session`, { headers: { 'CF-Connecting-IP': address, 'X-Forwarded-For': address } });
    assert.equal(response.status, 200);
    const session = await response.json() as { user: { id: string; name: string } | null };
    assert.equal(session.user, null);
  }
  const check = openDatabase(config.DATABASE_PATH);
  try {
    const rows = await check.db.select().from(budgets);
    assert.equal(rows.filter(row => row.key.startsWith('http:')).length, 1);
    assert.ok([1, 2].includes(rows.find(row => row.key.startsWith('http:'))!.used));
  } finally { check.close(); }
  await runtime.close();
  runtime = await startNodeServer(config);
  const response = await rpc('allGuilds', []);
  assert.equal(response.status, 200);
  const saved = await response.json() as { result: { id: string; joined_at: number }[] };
  assert.deepEqual(saved.result.map(row => row.id), [guild]);
});

test('Node bot client authenticates outbound RPC and refuses redirects and disabled calls', async t => {
  let redirect = false;
  let calls = 0;
  const server = createServer((request, response) => {
    calls++;
    assert.equal(request.headers.authorization, `Bearer ${environment.INTERNAL_RPC_SECRET}`);
    if (redirect) { response.writeHead(302, { Location: '/elsewhere' }); response.end(); return; }
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ result: { connected: true } }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const config = { ...environment, BOT_RPC_URL: `http://127.0.0.1:${address.port}/rpc` };
  await assert.rejects(createBotApi(config).health(), { message: 'The Discord bot is not enabled yet.' });
  assert.equal(calls, 0);
  const bot = createBotApi({ ...config, BOT_ENABLED: 'true' });
  assert.deepEqual(await bot.health(), { connected: true });
  redirect = true;
  await assert.rejects(bot.health());
  assert.equal(calls, 2);
});
