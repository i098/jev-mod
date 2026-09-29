import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { drizzle, type AsyncRemoteCallback } from 'drizzle-orm/sqlite-proxy';
import * as schema from './schema/index.ts';

export function migrateDatabase(database: DatabaseSync, folder = new URL('../migrations/', import.meta.url)) {
  const migrations = readdirSync(folder).filter(name => /^\d+_.+\.sql$/.test(name)).sort().map(name => {
    const sql = readFileSync(new URL(name, folder), 'utf8');
    return { name, sql, hash: createHash('sha256').update(sql).digest('hex') };
  });
  database.exec('BEGIN IMMEDIATE');
  try {
    database.exec('CREATE TABLE IF NOT EXISTS _jev_migrations (name TEXT PRIMARY KEY, hash TEXT NOT NULL)');
    const applied = database.prepare('SELECT name, hash FROM _jev_migrations').all();
    for (const row of applied) {
      if (!migrations.some(item => item.name === row.name && item.hash === row.hash)) throw new Error('Migration history does not match this build.');
    }
    for (const item of migrations) {
      if (applied.some(row => row.name === item.name)) continue;
      database.exec(item.sql);
      database.prepare('INSERT INTO _jev_migrations (name, hash) VALUES (?, ?)').run(item.name, item.hash);
    }
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

export function openDatabase(path: string) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const database = new DatabaseSync(path, { enableForeignKeyConstraints: true, timeout: 5000 });
  try {
    database.exec('PRAGMA journal_mode = WAL');
    migrateDatabase(database);
    const execute = (sql: string, params: SQLInputValue[], method: Parameters<AsyncRemoteCallback>[2]) => {
      const statement = database.prepare(sql);
      statement.setReturnArrays(true);
      if (method === 'run') return { rows: [], ...statement.run(...params) };
      if (method === 'get') return { rows: statement.get(...params) as unknown as unknown[] };
      return { rows: statement.all(...params) as unknown as unknown[][] };
    };
    const db = drizzle(async (sql, params, method) => execute(sql, params, method), async batch => {
      database.exec('BEGIN IMMEDIATE');
      try {
        const results = batch.map(item => execute(item.sql, item.params, item.method));
        database.exec('COMMIT');
        return results;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    }, { schema });
    return { db, close: () => database.close() };
  } catch (error) {
    database.close();
    throw error;
  }
}
