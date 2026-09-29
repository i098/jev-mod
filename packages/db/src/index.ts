import { drizzle } from 'drizzle-orm/d1';
import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { defaultSettings, type Settings } from '@jev-mod/core/policy.ts';
import type { NewCase, PolicyRecord } from '@jev-mod/core/types.ts';
import * as schema from './schema/index.ts';

export const createDb = (binding: D1Database) => drizzle(binding, { schema });
export function createStore(binding: D1Database) {
  const db = createDb(binding);
  return {
    db,
    async registerGuild(id: string) { await db.insert(schema.guilds).values({ id, joined_at: Date.now() }).onConflictDoNothing(); },
    async allGuilds() { return db.select().from(schema.guilds); },
    async getSettings(guildId: string): Promise<PolicyRecord> {
      const [row] = await db.select().from(schema.settings).where(eq(schema.settings.guild_id, guildId));
      return row ? { settings: row.config, version: row.version } : { settings: defaultSettings(), version: 0 };
    },
    async saveSettings(guildId: string, settings: Settings, expectedVersion: number, actorId: string): Promise<PolicyRecord> {
      const value = { config: settings, version: expectedVersion + 1, updated_by: actorId, updated_at: Date.now() };
      const rows = expectedVersion === 0
        ? await db.insert(schema.settings).values({ ...value, guild_id: guildId }).onConflictDoNothing().returning()
        : await db.update(schema.settings).set(value).where(and(eq(schema.settings.guild_id, guildId), eq(schema.settings.version, expectedVersion))).returning();
      if (!rows.length) throw Object.assign(new Error('Settings changed. Reload before saving.'), { status: 409 });
      // Audit insertion is a database trigger, atomic with the compare-and-set above.
      return { settings, version: expectedVersion + 1 };
    },
    async addCase(item: NewCase) {
      const [row] = await db.insert(schema.cases).values({ guild_id: item.guildId, channel_id: item.channelId,
        message_id: item.messageId, author_id: item.authorId, message_hash: item.messageHash,
        policy_version: item.policyVersion, content: item.content.slice(0, 4000), matches: item.matches,
        model: item.model, requested_action: item.requestedAction, outcome: item.outcome, created_at: Date.now() })
        .onConflictDoNothing().returning({ id: schema.cases.id });
      return row ? String(row.id) : null;
    },
    async getCase(guildId: string, id: string) {
      return (await db.select().from(schema.cases).where(and(eq(schema.cases.guild_id, guildId), eq(schema.cases.id, Number(id)))))[0];
    },
    async finishCase(guildId: string, id: string, outcome: string, actorId: string | null = null) {
      await db.update(schema.cases).set({ outcome, reviewed_by: actorId }).where(and(eq(schema.cases.guild_id, guildId), eq(schema.cases.id, Number(id))));
    },
    async claimCase(guildId: string, id: string, actorId: string) {
      const rows = await db.update(schema.cases).set({ outcome: 'reviewing', reviewed_by: actorId })
        .where(and(eq(schema.cases.guild_id, guildId), eq(schema.cases.id, Number(id)), inArray(schema.cases.outcome, ['monitored', 'logged', 'delete_failed'])))
        .returning({ id: schema.cases.id });
      return rows.length === 1;
    },
    async listCases(guildId: string, before = String(Number.MAX_SAFE_INTEGER)) {
      return db.select().from(schema.cases).where(and(eq(schema.cases.guild_id, guildId), lt(schema.cases.id, Number(before))))
        .orderBy(desc(schema.cases.id)).limit(50);
    },
    async stats(guildId: string) {
      const [row] = await db.select({ total: sql<number>`count(*)`,
        removed: sql<number>`coalesce(sum(${schema.cases.outcome} in ('deleted', 'deleted_timed_out', 'deleted_timeout_failed', 'deleted_timeout_skipped')), 0)`,
        review: sql<number>`coalesce(sum(${schema.cases.outcome} in ('monitored', 'logged', 'delete_failed')), 0)` })
        .from(schema.cases).where(eq(schema.cases.guild_id, guildId));
      return row;
    },
    async audit(guildId: string) { return db.select().from(schema.audit).where(eq(schema.audit.guild_id, guildId)).orderBy(desc(schema.audit.id)).limit(20); },
    async forgetGuild(guildId: string) { await db.delete(schema.guilds).where(eq(schema.guilds.id, guildId)); },
    async consumeBudget(key: string, limit: number) {
      const minute = Math.floor(Date.now() / 60000);
      const result = await binding.prepare(`INSERT INTO request_budgets (key, minute, used) VALUES (?, ?, 1)
        ON CONFLICT(key) DO UPDATE SET minute = excluded.minute,
          used = CASE WHEN request_budgets.minute = excluded.minute THEN request_budgets.used + 1 ELSE 1 END
        WHERE request_budgets.minute != excluded.minute OR request_budgets.used < ? RETURNING used`).bind(key, minute, limit).first();
      return Boolean(result);
    },
    async cleanup() {
      const expired = Date.now() - 30 * 86400000;
      await db.batch([
        db.delete(schema.cases).where(lt(schema.cases.created_at, expired)),
        db.delete(schema.audit).where(lt(schema.audit.created_at, expired)),
        db.delete(schema.budgets).where(lt(schema.budgets.minute, Math.floor(Date.now() / 60000) - 2)),
        db.delete(schema.verification).where(lt(schema.verification.expiresAt, new Date())),
        db.delete(schema.session).where(lt(schema.session.expiresAt, new Date())),
        db.update(schema.cases).set({ outcome: 'interrupted' }).where(and(inArray(schema.cases.outcome, ['pending', 'reviewing']), lt(schema.cases.created_at, Date.now() - 300000))),
      ]);
    },
  };
}
export type Store = ReturnType<typeof createStore>;
