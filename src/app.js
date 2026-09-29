import express from 'express';
import helmet from 'helmet';
import session from 'express-session';
import { rateLimit } from 'express-rate-limit';
import { fileURLToPath } from 'node:url';
import { PermissionFlagsBits } from 'discord.js';
import { z, ZodError } from 'zod';
import { catalog, settingsSchema, snowflake, localMatches, strongestAction } from './policy.js';
import { installAuth, constantEqual } from './auth.js';

export function createApp({ config, store, sessionStore, discord, classify, health, demo = null, fetcher }) {
  if (demo && config.NODE_ENV === 'production') throw new Error('Demo cannot run in production.');
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.TRUST_PROXY);
  app.use(helmet({ contentSecurityPolicy: { directives: { upgradeInsecureRequests: config.NODE_ENV === 'production' ? [] : null } } }));
  app.use(express.json({ limit: '64kb' }));
  app.use(rateLimit({ windowMs: 60000, limit: 180, standardHeaders: 'draft-8', legacyHeaders: false }));
  app.use(session({ name: 'jev.sid', secret: config.SESSION_SECRET, store: sessionStore,
    resave: false, saveUninitialized: false,
    cookie: { httpOnly: true, secure: config.NODE_ENV === 'production', sameSite: 'lax', maxAge: 3600000 },
  }));
  app.use(['/api', '/auth'], (request, response, next) => { response.set('Cache-Control', 'no-store'); next(); });
  const auth = installAuth(app, config, { demo: Boolean(demo), fetcher, stateStore: store });
  if (demo) app.use('/api', (request, response, next) => {
    request.session.user = demo.user;
    request.session.tokenExpires = Date.now() + 3600000;
    request.session.csrf ??= auth.nonce();
    next();
  });
  const permissionBits = PermissionFlagsBits.ViewChannel | PermissionFlagsBits.ReadMessageHistory
    | PermissionFlagsBits.SendMessages | PermissionFlagsBits.ManageMessages | PermissionFlagsBits.ModerateMembers;
  function invite(guildId = '') {
    if (demo) return null;
    const params = new URLSearchParams({ client_id: config.DISCORD_CLIENT_ID, scope: 'bot applications.commands',
      permissions: permissionBits.toString(), integration_type: '0' });
    if (guildId) { params.set('guild_id', guildId); params.set('disable_guild_select', 'true'); }
    return `https://discord.com/oauth2/authorize?${params}`;
  }
  app.get('/healthz', (request, response) => response.json({ status: 'ok' }));
  app.get('/api/session', (request, response) => {
    const signedIn = request.session.user && request.session.tokenExpires > Date.now();
    response.json({ user: signedIn ? request.session.user : null, csrf: signedIn ? request.session.csrf : null,
      demo: Boolean(demo), catalog, inviteUrl: invite() });
  });
  app.use('/api', (request, response, next) => {
    if (!request.session.user || request.session.tokenExpires <= Date.now()) return response.status(401).json({ error: 'Sign in with Discord to continue.' });
    if (!['GET', 'HEAD'].includes(request.method)
      && (request.get('origin') !== config.PUBLIC_URL || !constantEqual(request.get('x-csrf-token'), request.session.csrf))) {
      return response.status(403).json({ error: 'Request verification failed. Reload the dashboard.' });
    }
    next();
  });
  app.post('/api/logout', (request, response, next) => {
    request.session.destroy(error => {
      if (error) return next(error);
      response.clearCookie('jev.sid', { path: '/', secure: config.NODE_ENV === 'production', httpOnly: true, sameSite: 'lax' }).json({ ok: true });
    });
  });
  app.get('/api/guilds', async (request, response) => {
    const guilds = demo ? demo.guilds : await auth.guilds(request);
    response.json(guilds.map(guild => ({ ...guild, installed: discord.installed(guild.id), inviteUrl: invite(guild.id) })));
  });
  app.use('/api/guilds/:guildId', async (request, response, next) => {
    request.guildId = snowflake.parse(request.params.guildId);
    await discord.authorize(request.guildId, request.session.user.id);
    next();
  });
  app.get('/api/guilds/:guildId', async (request, response) => {
    const id = request.guildId;
    const [policy, metadata, cases, stats, audit] = await Promise.all([
      store.getSettings(id), discord.metadata(id), store.listCases(id), store.stats(id), store.audit(id),
    ]);
    response.json({ ...policy, metadata, cases, stats, audit, health: health(id), demo: Boolean(demo) });
  });
  app.put('/api/guilds/:guildId/settings', async (request, response) => {
    const body = z.object({ version: z.number().int().nonnegative(), settings: settingsSchema }).strict().parse(request.body);
    await discord.validateSettings(request.guildId, body.settings);
    response.json(await store.saveSettings(request.guildId, body.settings, body.version, request.session.user.id));
  });
  const testLimit = rateLimit({ windowMs: 60000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false });
  app.post('/api/guilds/:guildId/test', testLimit, async (request, response) => {
    const { content } = z.object({ content: z.string().trim().min(1).max(4000) }).strict().parse(request.body);
    const { settings } = await store.getSettings(request.guildId);
    const result = await classify(content, settings.rules);
    // The tester intentionally evaluates saved rules without channel or role exemptions.
    const mentions = new Set(content.match(/<@!?\d+>|<@&\d+>|@everyone|@here/g) ?? []);
    result.matches.push(...localMatches({ content, mentionCount: mentions.size }, settings));
    response.json({ ...result, action: !result.matches.length || settings.mode === 'off' ? 'allow'
      : settings.mode === 'monitor' ? 'monitor' : strongestAction(result.matches), mode: settings.mode });
  });
  app.get('/api/guilds/:guildId/cases', async (request, response) => {
    const before = request.query.before ? z.string().regex(/^\d{1,20}$/).parse(request.query.before) : undefined;
    response.json(await store.listCases(request.guildId, before));
  });
  app.post('/api/guilds/:guildId/cases/:caseId/review', async (request, response) => {
    const id = z.string().regex(/^\d{1,20}$/).parse(request.params.caseId);
    const { action } = z.object({ action: z.enum(['dismiss', 'delete']) }).strict().parse(request.body);
    const item = await store.getCase(request.guildId, id);
    if (!item) return response.status(404).json({ error: 'Case not found.' });
    if (!await store.claimCase(request.guildId, id, request.session.user.id)) return response.status(409).json({ error: 'Case was already handled. Refresh activity.' });
    let outcome = 'dismissed';
    if (action === 'delete') {
      try { outcome = await discord.enforce({ guildId: request.guildId, channelId: item.channel_id,
        messageId: item.message_id, hash: item.message_hash, action: 'delete', reason: `Jev-Mod case ${id}: moderator review` }); }
      catch { outcome = 'delete_failed'; }
    }
    await store.finishCase(request.guildId, id, outcome, request.session.user.id);
    response.json({ outcome });
  });
  app.use('/api', (request, response) => response.status(404).json({ error: 'Endpoint not found.' }));
  app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))));
  app.use((error, request, response, next) => {
    if (response.headersSent) return next(error);
    const status = error instanceof ZodError ? 400 : error.status ?? 500;
    // Error bodies, URLs, message contents, tokens, and session data never enter logs.
    if (status >= 500) console.error(JSON.stringify({ event: 'web_request_failed', status }));
    response.status(status).json({ error: error instanceof ZodError ? 'Invalid input. Check the field limits.'
      : status < 500 ? error.message : 'Service unavailable. No moderation action was requested. Try again shortly.' });
  });
  return app;
}
