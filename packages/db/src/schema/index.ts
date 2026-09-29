import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type { Match, Settings } from '@jev-mod/core/policy.ts';
export * from './auth.ts';

export const guilds = sqliteTable('guilds', { id: text('id').primaryKey(), joined_at: integer('joined_at').notNull() });
export const settings = sqliteTable('guild_settings', {
  guild_id: text('guild_id').primaryKey().references(() => guilds.id, { onDelete: 'cascade' }),
  config: text('config', { mode: 'json' }).$type<Settings>().notNull(),
  version: integer('version').notNull(), updated_by: text('updated_by').notNull(), updated_at: integer('updated_at').notNull(),
});
export const secrets = sqliteTable('guild_secrets', {
  guild_id: text('guild_id').primaryKey().references(() => guilds.id, { onDelete: 'cascade' }),
  typesafe_ciphertext: text('typesafe_ciphertext').notNull(),
  updated_by: text('updated_by').notNull(), updated_at: integer('updated_at').notNull(),
});
export const cases = sqliteTable('moderation_cases', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  guild_id: text('guild_id').notNull().references(() => guilds.id, { onDelete: 'cascade' }),
  channel_id: text('channel_id').notNull(), message_id: text('message_id').notNull(), author_id: text('author_id').notNull(),
  message_hash: text('message_hash').notNull(), message_revision: text('message_revision').notNull().default('created'),
  policy_version: integer('policy_version').notNull(),
  content: text('content').notNull(), matches: text('matches', { mode: 'json' }).$type<Match[]>().notNull(),
  model: text('model'), requested_action: text('requested_action').notNull(), outcome: text('outcome').notNull(),
  reviewed_by: text('reviewed_by'), created_at: integer('created_at').notNull(),
}, table => [uniqueIndex('message_revision').on(table.guild_id, table.message_id, table.message_revision, table.policy_version),
  index('guild_case_id').on(table.guild_id, table.id), index('case_retention').on(table.created_at)]);
export const audit = sqliteTable('settings_audit', {
  id: integer('id').primaryKey({ autoIncrement: true }), guild_id: text('guild_id').notNull().references(() => guilds.id, { onDelete: 'cascade' }),
  actor_id: text('actor_id').notNull(), event: text('event').notNull(), created_at: integer('created_at').notNull(),
}, table => [index('guild_audit_id').on(table.guild_id, table.id)]);
export const budgets = sqliteTable('request_budgets', { key: text('key').primaryKey(), minute: integer('minute').notNull(), used: integer('used').notNull() });
