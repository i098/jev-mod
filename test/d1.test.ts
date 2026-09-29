import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { Miniflare } from 'miniflare';
import { createStore } from '../packages/db/src/index.ts';
import { defaultSettings } from '../packages/core/src/policy.ts';
import { createDashboard, type BotApi, type Services, type User } from '../apps/server/src/app.ts';
import { storeBridge } from '../apps/server/src/bridge.ts';

test('D1 and HTTP contracts enforce tenant isolation, CAS, audit atomicity, budgets, and case claims', async t => {
  const runtime = new Miniflare({ modules: true, script: 'export default {fetch() {return new Response("test")}}',
    d1Databases: { DB: 'test' }, compatibilityDate: '2026-08-06' });
  t.after(() => runtime.dispose());
  const binding = await runtime.getD1Database('DB');
  const folder = new URL('../packages/db/migrations/', import.meta.url);
  for (const file of (await readdir(folder)).filter(file => file.endsWith('.sql')).sort()) {
    for (const sql of (await readFile(new URL(file, folder), 'utf8')).split('--> statement-breakpoint').filter(sql => sql.trim())) {
      await binding.prepare(sql).run();
    }
  }
  // Miniflare supplies the same D1 wire contract with separately declared TS types.
  const db = binding as unknown as D1Database;
  const store = createStore(db);
  const guild = '100000000000000001';
  const other = '100000000000000002';
  await store.registerGuild(guild); await store.registerGuild(other);
  const protectedSettings = { ...defaultSettings(), mode: 'protect' as const };
  const writes = await Promise.allSettled([store.saveSettings(guild, protectedSettings, 0, '600000000000000001'), store.saveSettings(guild, protectedSettings, 0, '600000000000000002')]);
  assert.equal(writes.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal((await store.audit(guild)).length, 1);
  assert.equal((await store.getSettings(other)).settings.mode, 'monitor');
  const budgets = await Promise.all(Array.from({ length: 5 }, () => store.consumeBudget('test-budget', 2)));
  assert.equal(budgets.filter(Boolean).length, 2);
  const item = { guildId: guild, channelId: '200000000000000001', messageId: '400000000000000001', authorId: '500000000000000001',
    messageHash: 'a'.repeat(64), policyVersion: 1, content: 'test evidence', matches: [], model: 'test', requestedAction: 'delete', outcome: 'monitored' };
  const caseId = (await store.addCase(item))!;
  assert.equal(await store.addCase(item), null);
  assert.equal(await store.getCase(other, caseId), undefined);
  assert.equal(await store.claimCase(other, caseId, 'reviewer'), false);

  let user: User | null = null;
  let permission = true;
  let checks = 0;
  const bot: BotApi = {
    async authorize(id) { checks++; if (!permission || id !== guild) throw Object.assign(new Error('Forbidden'), { status: 403 }); },
    async metadata(id) { return { id, name: 'Test', channels: [], roles: [], permissions: { manageMessages: true, moderateMembers: true } }; },
    async validateSettings() {}, async enforce() { return 'deleted'; }, async health() { return { connected: false }; },
  };
  const services: Services = { store, bot, origin: 'http://localhost:3102', clientId: guild, demo: false,
    user: async () => user, guilds: async () => [], auth: async () => new Response('{}'),
    classify: async () => ({ model: 'test', matches: [], scores: [] }) };
  const app = createDashboard(services);
  const path = `/api/guilds/${guild}`;
  assert.equal((await app.request(path)).status, 401);
  user = { id: 'test-user', discordId: '600000000000000001', name: 'Test' };
  assert.equal((await app.request(path)).status, 200);
  assert.equal(checks, 1);
  permission = false;
  assert.equal((await app.request(path)).status, 403);
  permission = true;
  const headers = { Origin: services.origin, 'Content-Type': 'application/json', 'x-jev-request': 'dashboard' };
  const body = JSON.stringify({ settings: defaultSettings(), version: 1 });
  assert.equal((await app.request(`${path}/settings`, { method: 'PUT', headers: { ...headers, Origin: 'https://evil.example' }, body })).status, 403);
  assert.equal((await app.request(`${path}/settings`, { method: 'PUT', headers, body })).status, 200);
  assert.equal((await app.request(`${path}/settings`, { method: 'PUT', headers, body })).status, 409);
  assert.equal((await app.request('/api/auth/get-access-token', { method: 'POST', headers, body: '{}' })).status, 404);
  assert.equal((await app.request(`/api/guilds/${other}/cases/${caseId}/review`, { method: 'POST', headers, body: JSON.stringify({ action: 'delete' }) })).status, 403);
  const claims = await Promise.all([store.claimCase(guild, caseId, 'one'), store.claimCase(guild, caseId, 'two')]);
  assert.deepEqual(claims.sort(), [false, true]);
  await store.finishCase(guild, caseId, 'deleted_timeout_failed');
  assert.equal((await store.stats(guild)).removed, 1);
  const invalidBridge = await storeBridge(new Request('http://jev.internal/store', { method: 'POST', body: JSON.stringify({ method: 'query', args: ['DROP TABLE guilds'] }) }), db);
  assert.equal(invalidBridge.status, 400);
  await binding.prepare('UPDATE moderation_cases SET created_at = ? WHERE id = ?').bind(Date.now() - 31 * 86400000, Number(caseId)).run();
  await store.cleanup();
  assert.equal((await store.listCases(guild)).length, 0);
  assert.equal((await store.getSettings(guild)).version, 2);
  await store.forgetGuild(guild);
  assert.equal((await store.listCases(guild)).length, 0);
  assert.equal((await store.audit(guild)).length, 0);
  await assert.rejects(() => store.addCase({ ...item, messageId: '400000000000000003' }),
    error => error instanceof Error && error.cause instanceof Error && /FOREIGN KEY/.test(error.cause.message));
  assert.equal((await store.listCases(guild)).length, 0);
});
