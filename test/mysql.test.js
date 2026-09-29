import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomInt } from 'node:crypto';
import mysql from 'mysql2/promise';
import { createStore, MysqlSessionStore } from '../src/store.js';
import { defaultSettings } from '../src/policy.js';

const database = process.env.TEST_DATABASE_URL;
test('MySQL persists isolated settings, claims, audit records, and encrypted sessions', { skip: !database }, async t => {
  if (!new URL(database).pathname.endsWith('_test')) throw new Error('Integration tests require a database whose name ends in _test.');
  const pool = mysql.createPool({ uri: database, supportBigNumbers: true, bigNumberStrings: true });
  t.after(() => pool.end());
  const [tables] = await pool.query('SHOW TABLES');
  if (!tables.length) {
    const schema = await readFile(new URL('../sql/schema.sql', import.meta.url), 'utf8');
    for (const statement of schema.split(';').filter(part => part.trim())) await pool.query(statement);
  }
  const store = createStore(pool);
  const guild = `7${Date.now()}${randomInt(1000, 9999)}`;
  const other = `8${guild.slice(1)}`;
  await store.createOAuthState(guild, 'sample-single-use-state', Date.now() + 60000);
  const claims = await Promise.all([store.consumeOAuthState(guild, 'sample-single-use-state'), store.consumeOAuthState(guild, 'sample-single-use-state')]);
  assert.deepEqual(claims.sort(), [false, true]);
  const settings = { ...defaultSettings(), mode: 'protect' };
  assert.equal((await store.saveSettings(guild, settings, 0, '600000000000000001')).version, 1);
  assert.equal((await store.getSettings(guild)).settings.mode, 'protect');
  assert.equal((await store.getSettings(other)).settings.mode, 'monitor');
  await assert.rejects(() => store.saveSettings(guild, settings, 0, '600000000000000001'), /Settings changed/);
  assert.equal((await store.audit(guild)).length, 1);
  const item = { guildId: guild, channelId: '200000000000000001', messageId: '400000000000000001',
    authorId: '500000000000000001', messageHash: 'a'.repeat(64), policyVersion: 1, content: 'test evidence',
    matches: [{ id: 'scams', probability: .99 }], model: 'test', requestedAction: 'delete', outcome: 'monitored' };
  const id = await store.addCase(item);
  assert.equal(await store.addCase(item), null);
  assert.equal(await store.getCase(other, id), undefined);
  assert.equal(await store.claimCase(other, id, '600000000000000001'), false);
  assert.equal(await store.claimCase(guild, id, '600000000000000001'), true);
  assert.equal(await store.claimCase(guild, id, '600000000000000001'), false);
  await store.finishCase(guild, id, 'deleted');
  assert.equal(Number((await store.stats(guild)).removed), 1);

  const sessions = new MysqlSessionStore(pool, 'integration-test-secret');
  const payload = { cookie: { expires: new Date(Date.now() + 60000).toISOString() }, accessToken: 'sample-token-for-encryption-test' };
  await new Promise((resolve, reject) => sessions.set(guild, payload, error => error ? reject(error) : resolve()));
  const [rows] = await pool.execute('SELECT payload FROM dashboard_sessions WHERE id = ?', [guild]);
  assert.equal(rows[0].payload.includes(payload.accessToken), false);
  const restored = await new Promise((resolve, reject) => sessions.get(guild, (error, value) => error ? reject(error) : resolve(value)));
  assert.equal(restored.accessToken, payload.accessToken);
  await new Promise((resolve, reject) => sessions.destroy(guild, error => error ? reject(error) : resolve()));
  await store.forgetGuild(guild);
  assert.equal((await store.listCases(guild)).length, 0);
  assert.equal((await store.audit(guild)).length, 0);
});
