import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { bodyLimit } from 'hono/body-limit';
import { z, ZodError } from 'zod';
import { settingsSchema, snowflake, localMatches, strongestAction, canManage } from '@jev-mod/core/policy.ts';
import type { Decision, GuildMetadata, Settings, SessionInfo } from './contracts.ts';
import type { Store } from '@jev-mod/db/index.ts';
import type { KeyStatus } from '@jev-mod/core/types.ts';

export type User = { id: string; name: string; discordId: string; accessToken?: string };
export type BotApi = {
  authorize(guild: string, user: string): Promise<unknown>;
  metadata(guild: string): Promise<GuildMetadata>;
  validateSettings(guild: string, settings: Settings): Promise<unknown>;
  enforce(input: Record<string, unknown>): Promise<string>;
  health(): Promise<{ connected: boolean }>;
};
export type Services = {
  store: Store; bot: BotApi; origin: string; clientId: string; demo: boolean;
  user(request: Request): Promise<User | null>;
  auth(request: Request): Promise<Response>;
  classify(guildId: string, text: string, expectedVersion?: number): Promise<Decision>;
  keyStatus(guildId: string): Promise<KeyStatus>;
  saveKey(guildId: string, key: string, actorId: string): Promise<KeyStatus>;
  removeKey(guildId: string, actorId: string): Promise<KeyStatus>;
  clientAddress(request: Request): string;
  guilds(user: User, request: Request): Promise<{ id: string; name: string; installed: boolean }[]>;
};
type Context = { Variables: { user: User; guildId: string } };
const idSchema = z.string().regex(/^\d{1,16}$/);
const caseQuery = z.object({ before: idSchema.optional(), search: z.string().trim().max(200).optional(),
  outcome: z.enum(['review', 'removed', 'monitored', 'logged', 'pending', 'reviewing', 'deleted', 'delete_failed', 'deleted_timed_out',
    'deleted_timeout_failed', 'deleted_timeout_skipped', 'dismissed', 'interrupted', 'policy_changed', 'message_changed', 'exempt', 'already_gone', 'member_check_failed', 'missing_permission']).optional(),
  rule: z.enum(['scams', 'spam', 'hate', 'harassment', 'threats', 'sexual', 'phrases', 'mentions']).optional(), channel: snowflake.optional(),
  from: z.coerce.number().int().min(0).max(8640000000000000).optional(), to: z.coerce.number().int().min(0).max(8640000000000000).optional(),
}).strict().refine(query => query.from === undefined || query.to === undefined || query.from <= query.to);
const problem = (message: string, status: number) => Object.assign(new Error(message), { status });
const botPermissions = (1024n | 2048n | 8192n | 65536n | (1n << 40n)).toString();

export function createDashboard(services: Services) {
  const app = new Hono<Context>();
  const { store, bot } = services;
  app.use('*', secureHeaders({ referrerPolicy: 'no-referrer' }));
  app.use('/api/*', bodyLimit({ maxSize: 65536, onError: c => c.json({ error: 'Request too large.' }, 413) }));
  app.use('/api/*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    const address = services.clientAddress(c.req.raw);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(address));
    const key = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
    if (!await store.consumeBudget(`http:${key}`, 180)) return c.json({ error: 'Too many requests. Try again in a minute.' }, 429);
    await next();
    c.header('Cache-Control', 'no-store');
  });
  const publicAuth = new Set(['/api/auth/get-session', '/api/auth/sign-in/social', '/api/auth/sign-out',
    '/api/auth/callback/discord', '/api/auth/error', '/api/auth/ok']);
  app.get('/api/install', async c => {
    if (services.demo) throw problem('Discord installation is disabled in preview.', 409);
    const { guild_id: guild } = z.object({ guild_id: snowflake.optional() }).strict().parse(c.req.query());
    const headers = new Headers({ 'Content-Type': 'application/json', Origin: services.origin });
    const cookie = c.req.header('cookie');
    if (cookie) headers.set('Cookie', cookie);
    const authorization = await services.auth(new Request(`${services.origin}/api/auth/sign-in/social`, {
      method: 'POST', headers, body: JSON.stringify({ provider: 'discord', disableRedirect: true,
        scopes: ['bot', 'applications.commands'],
        additionalParams: { permissions: botPermissions, integration_type: '0', prompt: 'consent',
          ...(guild ? { guild_id: guild, disable_guild_select: 'true' } : {}) },
        callbackURL: `${services.origin}${guild ? `/servers/${guild}/rules` : '/'}?installed=1`,
        errorCallbackURL: `${services.origin}/?installation=cancelled`,
      }),
    }));
    const redirectHeaders = new Headers(authorization.headers);
    redirectHeaders.set('Cache-Control', 'no-store');
    if (!authorization.ok) return new Response(authorization.body, { status: authorization.status, headers: redirectHeaders });
    const { url } = z.object({ url: z.url() }).parse(await authorization.json());
    redirectHeaders.delete('Content-Type');
    redirectHeaders.delete('Content-Length');
    redirectHeaders.set('Location', url);
    return new Response(null, { status: 302, headers: redirectHeaders });
  });
  app.on(['GET', 'POST'], '/api/auth/*', c => {
    if (!publicAuth.has(c.req.path)) return c.json({ error: 'Not found.' }, 404);
    return services.auth(c.req.raw);
  });
  function invite(guild = '') {
    if (services.demo) return null;
    return `${services.origin}/api/install${guild ? `?guild_id=${guild}` : ''}`;
  }
  app.get('/api/session', async c => {
    const user = await services.user(c.req.raw);
    return c.json({ user: user ? { id: user.discordId, name: user.name } : null, demo: services.demo, inviteUrl: invite() } satisfies SessionInfo);
  });
  app.use('/api/*', async (c, next) => {
    const user = await services.user(c.req.raw);
    if (!user) return c.json({ error: 'Sign in with Discord to continue.' }, 401);
    c.set('user', user);
    if (!['GET', 'HEAD'].includes(c.req.method) && (c.req.header('origin') !== services.origin
      || c.req.header('x-jev-request') !== 'dashboard' || !c.req.header('content-type')?.startsWith('application/json'))) {
      return c.json({ error: 'Request verification failed. Reload the dashboard.' }, 403);
    }
    await next();
  });
  app.get('/api/guilds', async c => c.json((await services.guilds(c.get('user'), c.req.raw)).map(guild => ({ ...guild, inviteUrl: invite(guild.id) }))));
  app.use('/api/guilds/:guildId/*', async (c, next) => {
    const id = snowflake.parse(c.req.param('guildId'));
    await bot.authorize(id, c.get('user').discordId);
    c.set('guildId', id);
    await next();
  });
  // Hono's wildcard middleware includes both the base path and its descendants.
  app.get('/api/guilds/:guildId', async c => {
    const guildId = c.get('guildId');
    const [policy, metadata, stats, audit, health, keyStatus] = await Promise.all([
      store.getSettings(guildId), bot.metadata(guildId), store.stats(guildId), store.audit(guildId), bot.health(), services.keyStatus(guildId),
    ]);
    return c.json({ ...policy, metadata, stats, audit, health, keyStatus, demo: services.demo });
  });
  app.put('/api/guilds/:guildId/settings', async c => {
    const body = z.object({ settings: settingsSchema, version: z.number().int().nonnegative() }).strict().parse(await c.req.json());
    await bot.validateSettings(c.get('guildId'), body.settings);
    return c.json(await store.saveSettings(c.get('guildId'), body.settings, body.version, c.get('user').discordId));
  });
  app.post('/api/guilds/:guildId/test', async c => {
    const { content } = z.object({ content: z.string().trim().min(1).max(4000) }).strict().parse(await c.req.json());
    const { settings, version } = await store.getSettings(c.get('guildId'));
    if (settings.rules.some(rule => rule.enabled) && !await store.consumeBudget(`tester:${c.get('user').id}`, 10)) return c.json({ error: 'Message test limit reached.' }, 429);
    const result = await services.classify(c.get('guildId'), content, version);
    const mentions = new Set([...content.matchAll(/<@!?(\d{17,20})>|<@&(\d{17,20})>|@everyone|@here/g)]
      .map(([, user, role]) => user ? `user:${user}` : role ? `role:${role}` : 'everyone'));
    result.matches.push(...localMatches({ content, mentionCount: mentions.size }, settings));
    return c.json({ ...result, action: !result.matches.length || settings.mode === 'off' ? 'allow'
      : settings.mode === 'monitor' ? 'monitor' : strongestAction(result.matches) });
  });
  app.put('/api/guilds/:guildId/key', async c => {
    if (services.demo) throw problem('API keys are disabled in preview.', 409);
    const { key } = z.object({ key: z.string().trim().min(10).max(512) }).strict().parse(await c.req.json());
    return c.json(await services.saveKey(c.get('guildId'), key, c.get('user').discordId));
  });
  app.delete('/api/guilds/:guildId/key', async c => {
    if (services.demo) throw problem('API keys are disabled in preview.', 409);
    return c.json(await services.removeKey(c.get('guildId'), c.get('user').discordId));
  });
  app.get('/api/guilds/:guildId/cases', async c => c.json(await store.listCases(c.get('guildId'), caseQuery.parse(c.req.query()))));
  app.post('/api/guilds/:guildId/cases/:caseId/review', async c => {
    const id = idSchema.parse(c.req.param('caseId'));
    const { action } = z.object({ action: z.enum(['dismiss', 'delete']) }).strict().parse(await c.req.json());
    const guildId = c.get('guildId');
    const item = await store.getCase(guildId, id);
    if (!item) throw problem('Case not found.', 404);
    if (services.demo && action === 'delete') throw problem('Discord actions are disabled in preview.', 409);
    if (!await store.claimCase(guildId, id, c.get('user').discordId)) throw problem('Case was already handled. Refresh activity.', 409);
    let outcome = 'dismissed';
    if (action === 'delete') {
      try { outcome = await bot.enforce({ guildId, channelId: item.channel_id, messageId: item.message_id,
        hash: item.message_hash, revision: item.message_revision, action: 'delete', reason: `Jev-Mod case ${id}: moderator review` }); }
      catch { outcome = 'delete_failed'; }
    }
    await store.finishCase(guildId, id, outcome, c.get('user').discordId);
    return c.json({ outcome });
  });
  app.notFound(c => c.json({ error: 'Not found.' }, 404));
  app.onError((error, c) => {
    const failure = error as Error & { status?: unknown; statusCode?: unknown };
    const candidate = failure.statusCode ?? failure.status;
    const status = error instanceof ZodError || error instanceof SyntaxError ? 400
      : typeof candidate === 'number' && Number.isInteger(candidate) && candidate >= 400 && candidate <= 599 ? candidate : 503;
    if (status >= 500) console.error(JSON.stringify({ event: 'request_failed', status }));
    return c.json({ error: status === 400 ? 'Invalid input. Check the field limits.' : status < 500 ? error.message
      : 'Service unavailable. Refresh activity before retrying an action.' }, status as 400);
  });
  return app;
}

export async function listDiscordGuilds(accessToken: string) {
  const guilds: { id: string; name: string; permissions: string; owner?: boolean }[] = [];
  let after = '0';
  for (let page = 0; page < 5; page++) {
    const response = await fetch(`https://discord.com/api/v10/users/@me/guilds?limit=200&after=${after}`, {
      headers: { Authorization: `Bearer ${accessToken}`, 'User-Agent': 'DiscordBot (https://github.com/i098/jev-mod, 0.1.0)' }, signal: AbortSignal.timeout(8000), redirect: 'manual' });
    if (!response.ok) {
      console.warn(JSON.stringify({ event: 'discord_guilds_failed', status: response.status }));
      throw problem('Discord is unavailable. Sign in again or try shortly.', response.status === 401 ? 401 : 503);
    }
    const batch = z.array(z.object({ id: snowflake, name: z.string(), permissions: z.string(), owner: z.boolean().optional() })).parse(await response.json());
    guilds.push(...batch.filter(canManage));
    if (batch.length < 200) break;
    after = batch.reduce((max, guild) => BigInt(guild.id) > BigInt(max) ? guild.id : max, after);
  }
  return guilds;
}
