import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { Miniflare } from 'miniflare';
import { defaultSettings } from '../packages/core/src/policy.ts';

for (const engine of ['sqlite', 'd1'] as const) {
  test(`${engine}: threshold migration preserves settings and invalidates stale drafts once`, async t => {
    const local = engine === 'sqlite' ? new DatabaseSync(':memory:') : null;
    const runtime = engine === 'd1' ? new Miniflare({ modules: true, script: 'export default {fetch() {return new Response("test")}}', d1Databases: { DB: 'threshold-test' }, compatibilityDate: '2026-08-06' }) : null;
    t.after(async () => { local?.close(); await runtime?.dispose(); });
    const binding = await runtime?.getD1Database('DB');
    const run = async (sql: string, values: (string | number)[] = []) => local ? local.prepare(sql).run(...values) : binding!.prepare(sql).bind(...values).run();
    const rows = async (sql: string) => local ? local.prepare(sql).all() : (await binding!.prepare(sql).all()).results;
    const folder = new URL('../packages/db/migrations/', import.meta.url);
    for (const file of (await readdir(folder)).filter(name => name.endsWith('.sql') && name < '0003').sort()) {
      for (const sql of (await readFile(new URL(file, folder), 'utf8')).split('--> statement-breakpoint').filter(sql => sql.trim())) await run(sql);
    }
    const before = { ...defaultSettings(), mode: 'protect' as const, blockedPhrases: ['keep me'], timeoutMinutes: 25,
      rules: defaultSettings().rules.map((rule, i) => ({ ...rule, threshold: 0.5 + i / 10, enabled: i !== 1, action: i === 2 ? 'timeout' as const : rule.action })) };
    for (const id of ['100000000000000001', '100000000000000002']) {
      await run('INSERT INTO guilds (id, joined_at) VALUES (?, ?)', [id, 1]);
      await run('INSERT INTO guild_settings (guild_id, config, version, updated_by, updated_at) VALUES (?, ?, ?, ?, ?)', [id, JSON.stringify(before), 7, 'moderator', 1]);
    }
    const migration = await readFile(new URL('0003_rule_threshold_65.sql', folder), 'utf8');
    await run(migration);
    for (const row of await rows('SELECT * FROM guild_settings')) {
      assert.deepEqual(JSON.parse(String(row.config)), { ...before, rules: before.rules.map(rule => ({ ...rule, threshold: 0.65 })) });
      assert.equal(row.version, 8);
      assert.equal(row.updated_by, 'system:threshold-65');
      assert.ok(Number(row.updated_at) > 1);
    }
    await run(migration);
    assert.ok((await rows('SELECT version FROM guild_settings')).every(row => row.version === 8));
    assert.equal((await rows("SELECT * FROM settings_audit WHERE actor_id = 'system:threshold-65'")).length, 2);
  });
}
