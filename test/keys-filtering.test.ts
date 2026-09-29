import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Miniflare } from 'miniflare';
import { createDb, createStore, type Store } from '../packages/db/src/index.ts';
import { openDatabase } from '../packages/db/src/node.ts';
import { cases } from '../packages/db/src/schema/index.ts';
import { defaultSettings } from '../packages/core/src/policy.ts';
import type { NewCase } from '../packages/core/src/types.ts';
import { messageHash } from '../packages/core/src/moderation.js';
import { createDashboard, type BotApi } from '../apps/server/src/app.ts';
import { storeBridge } from '../apps/server/src/bridge.ts';
import { decryptKey, encryptKey } from '../apps/server/src/keys.ts';
import { createServices, type RuntimeEnv } from '../apps/server/src/services.ts';

const { eq } = createRequire(new URL('../packages/db/package.json', import.meta.url))('drizzle-orm');
const guild = '100000000000000001';
const other = '100000000000000002';
const channel = '200000000000000001';
const actor = '600000000000000001';
const secret = '11'.repeat(32);
const operatorKey = 'sample-operator-typesafe-key';
const serverKey = 'sample-server-typesafe-key';
const replacementKey = 'sample-replacement-typesafe-key';
const migrationsFolder = new URL('../packages/db/migrations/', import.meta.url);

async function migrations() {
  return Promise.all((await readdir(migrationsFolder)).filter(name => name.endsWith('.sql')).sort().map(async name => ({
    name, sql: await readFile(new URL(name, migrationsFolder), 'utf8'),
  })));
}
function sampleCase(index: number, guildId = guild): NewCase {
  return { guildId, channelId: channel, messageId: String(400000000000000000n + BigInt(index)), authorId: actor,
    messageHash: messageHash('sample evidence'), messageRevision: 'created', policyVersion: 1, content: 'sample evidence',
    matches: [{ id: 'scams', name: 'Scams', probability: 1, action: 'delete' }], model: 'sample', requestedAction: 'delete', outcome: 'monitored' };
}
async function seedLegacy(run: (sql: string, parameters: (string | number)[]) => Promise<unknown>) {
  await run('INSERT INTO guilds (id, joined_at) VALUES (?, ?)', [guild, 1000]);
  for (const [index, content] of ['text A', 'text B'].entries()) {
    await run(`INSERT INTO moderation_cases (guild_id, channel_id, message_id, author_id, message_hash,
      policy_version, content, matches, model, requested_action, outcome, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [guild, channel, sampleCase(1).messageId, actor, messageHash(content), 1, content, '[]', 'sample', 'delete', 'message_changed', 1000 + index]);
  }
}
async function backend(t: TestContext, kind: 'D1' | 'SQLite', legacy = false): Promise<Store> {
  if (kind === 'D1') {
    const runtime = new Miniflare({ modules: true, script: 'export default {fetch() {return new Response("sample")}}',
      d1Databases: { DB: 'keys-filtering' }, compatibilityDate: '2026-08-06' });
    t.after(() => runtime.dispose());
    const binding = await runtime.getD1Database('DB');
    for (const migration of await migrations()) {
      if (legacy && migration.name.startsWith('0002_')) await seedLegacy((sql, parameters) => binding.prepare(sql).bind(...parameters).run());
      for (const statement of migration.sql.split('--> statement-breakpoint').filter(sql => sql.trim())) await binding.prepare(statement).run();
    }
    return createStore(createDb(binding as unknown as D1Database));
  }
  let path = ':memory:';
  if (legacy) {
    const artifacts = new URL('../artifacts/', import.meta.url);
    await mkdir(artifacts, { recursive: true });
    const directory = await mkdtemp(join(fileURLToPath(artifacts), 'revision-migration-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    path = join(directory, 'legacy.sqlite');
    const database = new DatabaseSync(path);
    try {
      database.exec('CREATE TABLE _jev_migrations (name TEXT PRIMARY KEY, hash TEXT NOT NULL)');
      for (const migration of await migrations()) {
        if (migration.name.startsWith('0002_')) break;
        database.exec(migration.sql);
        database.prepare('INSERT INTO _jev_migrations (name, hash) VALUES (?, ?)')
          .run(migration.name, createHash('sha256').update(migration.sql).digest('hex'));
      }
      await seedLegacy(async (sql, parameters) => database.prepare(sql).run(...parameters));
    } finally { database.close(); }
  }
  const database = openDatabase(path);
  t.after(() => database.close());
  return createStore(database.db);
}
function dashboard(store: Store) {
  const allowed = new Set([guild]);
  const env: RuntimeEnv = { PUBLIC_URL: 'http://localhost:3102', BETTER_AUTH_SECRET: 'sample-auth-secret-with-more-than-32-characters',
    DISCORD_CLIENT_ID: guild, DISCORD_CLIENT_SECRET: 'sample-oauth-secret', KEY_ENCRYPTION_SECRET: secret, TYPESAFE_API_KEY: operatorKey };
  const bot: BotApi = {
    async authorize(id) { if (!allowed.has(id)) throw Object.assign(new Error('Forbidden'), { status: 403 }); },
    async metadata(id) { return { id, name: 'Sample server', channels: [], roles: [], permissions: { manageMessages: true, moderateMembers: true } }; },
    async validateSettings() {}, async enforce() { throw new Error('Discord actions are not available in this test'); },
    async health() { return { connected: false }; },
  };
  const services = createServices(env, store, bot, () => '127.0.0.1');
  services.user = async () => ({ id: 'sample-user', discordId: actor, name: 'Sample administrator' });
  services.guilds = async () => [];
  const app = createDashboard(services);
  const request = (path: string, method = 'GET', body?: unknown) => app.request(path, { method,
    headers: { Origin: env.PUBLIC_URL, 'Content-Type': 'application/json', 'x-jev-request': 'dashboard' },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) });
  return { request, services, allowed, env };
}
function assertNoKeys(value: unknown) {
  const serialized = JSON.stringify(value);
  for (const key of [operatorKey, serverKey, replacementKey, secret]) assert.equal(serialized.includes(key), false);
}

for (const kind of ['D1', 'SQLite'] as const) {
  test(`${kind}: encrypted server keys stay private and tester and bot share key selection`, async t => {
    const store = await backend(t, kind);
    await store.registerGuild(guild); await store.registerGuild(other);
    const settings = { ...defaultSettings(), mode: 'protect' as const,
      rules: defaultSettings().rules.map((rule, index) => ({ ...rule, enabled: index === 0 })) };
    let policy = await store.saveSettings(guild, settings, 0, actor);
    const { request, services, env } = dashboard(store);
    const path = `/api/guilds/${guild}`;
    const seenKeys: string[] = [];
    const budgets: string[] = [];
    const consumeBudget = store.consumeBudget.bind(store);
    t.mock.method(store, 'consumeBudget', async (key: string, limit: number) => { budgets.push(key); return consumeBudget(key, limit); });
    t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, options?: RequestInit) => {
      assert.equal(String(input), 'https://api.typesafe.ai/v1/systemone');
      seenKeys.push(new Headers(options?.headers).get('Authorization')!);
      return Response.json({ model: 'jev-1.13.0', answers: { scams: { type: 'noul', noul: 0.95 } } });
    });
    const classifyBoth = async (key: string) => {
      const start = seenKeys.length;
      budgets.length = 0;
      const response = await request(`${path}/test`, 'POST', { content: 'sample evidence' });
      assert.equal(response.status, 200);
      const tested = await response.json() as { action: string };
      assert.equal(tested.action, 'delete');
      const bridge = await storeBridge(new Request('http://jev.internal/store', { method: 'POST',
        body: JSON.stringify({ method: 'classify', args: [guild, 'sample evidence', policy.version] }) }), store, services.classify);
      assert.equal(bridge.status, 200);
      const result = await bridge.json() as { result: { matches: unknown[] } };
      assert.equal(result.result.matches.length, 1);
      assertNoKeys(result);
      assert.deepEqual(seenKeys.slice(start), [`Bearer ${key}`, `Bearer ${key}`]);
      assert.equal(budgets.filter(value => value === `jev:guild:${guild}`).length, 2);
      assert.equal(budgets.filter(value => value === 'jev:global').length, 2);
    };
    const caseReads = t.mock.method(store, 'listCases');
    const dashboardStatus = async () => {
      const response = await request(path);
      assert.equal(response.status, 200);
      const data = await response.json() as Record<string, unknown>;
      assert.equal(Object.hasOwn(data, 'cases'), false);
      assertNoKeys(data);
      return data.keyStatus;
    };
    assert.deepEqual(await dashboardStatus(), { source: 'operator' });
    assert.equal(caseReads.mock.calls.length, 0);
    assert.equal((await request(`${path}/key`)).status, 404);
    for (const key of [serverKey, replacementKey]) {
      const response = await request(`${path}/key`, 'PUT', { key });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { source: 'server' });
      const ciphertext = (await store.getTypeSafeKey(guild))!;
      assert.notEqual(ciphertext, key);
      assert.equal(await decryptKey(guild, ciphertext, secret), key);
      assert.equal(await store.getTypeSafeKey(other), undefined);
      assert.deepEqual(await dashboardStatus(), { source: 'server' });
      await classifyBoth(key);
    }
    const first = await encryptKey(guild, serverKey, secret);
    const second = await encryptKey(guild, serverKey, secret);
    assert.notEqual(first, second);
    assert.equal(await decryptKey(guild, first, secret), serverKey);
    await assert.rejects(decryptKey(other, first, secret), /KEY_DECRYPTION_FAILED/);
    await assert.rejects(decryptKey(guild, first, '22'.repeat(32)), /KEY_DECRYPTION_FAILED/);
    await store.addCase(sampleCase(1));
    assert.deepEqual(await store.stats(guild), { total: 1, removed: 0, review: 1 });
    assert.deepEqual(await dashboardStatus(), { source: 'server' });
    assert.equal(caseReads.mock.calls.length, 0);
    const response = await request(`${path}/cases`);
    assert.equal(response.status, 200);
    const page = await response.json() as { content: string }[];
    assert.equal(page.length, 1);
    assert.equal(page[0].content, 'sample evidence');
    assertNoKeys(page);
    assert.equal(caseReads.mock.calls.length, 1);
    assertNoKeys(await store.audit(guild));
    assertNoKeys(await store.listCases(guild));
    for (const method of ['PUT', 'DELETE']) {
      const denied = await request(`/api/guilds/${other}/key`, method, { key: serverKey });
      assert.equal(denied.status, 403);
      assertNoKeys(await denied.json());
    }
    assert.equal(await store.getTypeSafeKey(other), undefined);
    assert.equal((await store.audit(other)).length, 0);
    const removal = await request(`${path}/key`, 'DELETE');
    assert.equal(removal.status, 200);
    assert.deepEqual(await removal.json(), { source: 'operator' });
    assert.equal(await store.getTypeSafeKey(guild), undefined);
    await classifyBoth(operatorKey);
    env.TYPESAFE_API_KEY = '';
    assert.deepEqual(await dashboardStatus(), { source: 'missing' });
    const missing = await request(`${path}/test`, 'POST', { content: 'sample evidence' });
    assert.equal(missing.status, 409);
    const missingBody = await missing.json() as { error: string };
    assert.match(missingBody.error, /TypeSafe API key/);
    assertNoKeys(missingBody);
    await assert.rejects(services.classify(guild, 'sample evidence', policy.version), (error: unknown) =>
      error instanceof Error && 'status' in error && error.status === 409);
    const requests = seenKeys.length;
    policy = await store.saveSettings(guild, { ...settings, blockedPhrases: ['sample evidence'],
      rules: settings.rules.map(rule => ({ ...rule, enabled: false })) }, policy.version, actor);
    budgets.length = 0;
    assert.deepEqual(await services.classify(guild, 'sample evidence', policy.version), { model: null, matches: [], scores: [] });
    assert.equal(budgets.length, 0);
    const local = await request(`${path}/test`, 'POST', { content: 'SAMPLE EVIDENCE' });
    assert.equal(local.status, 200);
    const localBody = await local.json() as { action: string; matches: { id: string }[] };
    assert.equal(localBody.action, 'delete');
    assert.equal(localBody.matches[0].id, 'phrases');
    assert.equal(budgets.some(key => key.startsWith('jev:') || key.startsWith('tester:')), false);
    assert.equal(seenKeys.length, requests);
    assert.deepEqual((await store.audit(guild)).filter(row => row.event.includes('TypeSafe')).map(row => row.event).sort(),
      ['Removed TypeSafe API key', 'Saved TypeSafe API key', 'Saved TypeSafe API key'].sort());
  });

  test(`${kind}: case filters search beyond the first page and preserve tenant boundaries`, async t => {
    const store = await backend(t, kind);
    await store.registerGuild(guild); await store.registerGuild(other);
    const targetTime = Date.UTC(2026, 8, 1);
    const target = { ...sampleCase(1), content: 'Older Needle 50%_ sample', outcome: 'deleted_timeout_failed' };
    const targetId = (await store.addCase(target))!;
    await store.db.update(cases).set({ created_at: targetTime }).where(eq(cases.id, Number(targetId)));
    const hiddenId = (await store.addCase({ ...target, guildId: other }))!;
    await store.db.update(cases).set({ created_at: targetTime }).where(eq(cases.id, Number(hiddenId)));
    for (let index = 2; index <= 65; index++) await store.addCase({ ...sampleCase(index), channelId: '200000000000000002',
      matches: [{ id: 'spam', name: 'Spam', probability: 1, action: 'log' }] });
    const { request, allowed } = dashboard(store);
    const path = `/api/guilds/${guild}/cases`;
    const first = await (await request(path)).json() as { id: number }[];
    assert.equal(first.length, 50);
    assert.equal(first.some(row => String(row.id) === targetId), false);
    const next = await (await request(`${path}?before=${first.at(-1)!.id}`)).json() as { id: number }[];
    assert.equal(next.length, 15);
    assert.equal(new Set([...first, ...next].map(row => row.id)).size, 65);
    const queries: Record<string, string>[] = [
      { search: 'NEEDLE' }, { search: '50%_' }, { outcome: 'removed' }, { outcome: 'deleted_timeout_failed' },
      { rule: 'scams' }, { channel }, { from: String(targetTime), to: String(targetTime) },
      { search: 'needle', outcome: 'removed', rule: 'scams', channel, from: String(targetTime), to: String(targetTime) },
    ];
    for (const query of queries) {
      const response = await request(`${path}?${new URLSearchParams(query)}`);
      assert.equal(response.status, 200);
      const rows = await response.json() as { id: number }[];
      assert.deepEqual(rows.map(row => String(row.id)), [targetId]);
    }
    assert.deepEqual(await (await request(`${path}?from=${targetTime + 1}&to=${targetTime + 2}`)).json(), []);
    assert.equal((await request(`${path}?from=2&to=1`)).status, 400);
    assert.equal((await request(`/api/guilds/${other}/cases?search=needle`)).status, 403);
    allowed.add(other);
    const otherRows = await (await request(`/api/guilds/${other}/cases?search=needle`)).json() as { id: number }[];
    assert.deepEqual(otherRows.map(row => String(row.id)), [hiddenId]);
  });

  test(`${kind}: revision migration preserves old cases and restored text gets a new claim`, async t => {
    const store = await backend(t, kind, true);
    const old = await store.listCases(guild);
    assert.equal(old.length, 2);
    assert.deepEqual(old.map(row => row.content).sort(), ['text A', 'text B']);
    assert.deepEqual(old.map(row => row.message_revision).sort(), ['legacy:1', 'legacy:2']);
    for (const row of old) assert.equal(row.message_hash, messageHash(row.content));
    for (const [revision, content] of [['created', 'text A'], ['1000', 'text B'], ['2000', 'text A']]) {
      const item = { ...sampleCase(1), messageRevision: revision, content, messageHash: messageHash(content) };
      assert.notEqual(await store.addCase(item), null);
      assert.equal(await store.addCase(item), null);
    }
    assert.equal((await store.listCases(guild)).length, 5);
  });
}
