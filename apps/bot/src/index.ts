import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { Events, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { z } from 'zod';
import { createModerator, createQueue } from '@jev-mod/core/moderation.js';
import { snowflake, settingsSchema } from '@jev-mod/core/policy.ts';
import type { Decision, NewCase, PolicyRecord } from '@jev-mod/core/types.ts';
import { createDiscord } from './discord.js';

const config = z.object({ DISCORD_BOT_TOKEN: z.string().min(30), INTERNAL_RPC_SECRET: z.string().min(32).optional(),
  PUBLIC_URL: z.url(), STORE_URL: z.enum(['http://jev.internal/store', 'http://server:7102/internal/store']) })
  .refine(value => value.STORE_URL === 'http://jev.internal/store' || Boolean(value.INTERNAL_RPC_SECRET)).parse(process.env);
async function rpc<T>(method: string, args: unknown[]): Promise<T> {
  const response = await fetch(config.STORE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json',
    ...(config.INTERNAL_RPC_SECRET ? { Authorization: `Bearer ${config.INTERNAL_RPC_SECRET}` } : {}) },
    body: JSON.stringify({ method, args }), signal: AbortSignal.timeout(method === 'classify' ? 12000 : 8000), redirect: 'error' });
  if (!response.ok) throw new Error('STORE_UNAVAILABLE');
  return ((await response.json()) as { result: T }).result;
}
const store = {
  getSettings: (guild: string) => rpc<PolicyRecord>('getSettings', [guild]),
  addCase: (item: NewCase) => rpc<string | null>('addCase', [item]),
  finishCase: (guild: string, id: string, outcome: string) => rpc('finishCase', [guild, id, outcome]),
};
const discord = createDiscord(config.DISCORD_BOT_TOKEN);
const report = (event: string, guildId: string) => console.warn(JSON.stringify({ event, guildId }));
const moderate = createModerator({ store, discord, classify: (guildId: string, content: string, version: number) => rpc<Decision>('classify', [guildId, content, version]), report });
const enqueue = createQueue(async (message: unknown) => moderate(await discord.snapshot(message)), { onError: report });
let initialized = false;
let gatewayReady = false;
let guildWrites = Promise.resolve();
discord.onMessage((message: unknown) => { if (initialized) enqueue(message); });
discord.client.on(Events.Error, () => console.error(JSON.stringify({ event: 'discord_error' })));
discord.client.on(Events.ShardReady, async () => {
  if (gatewayReady) {
    console.warn(JSON.stringify({ event: 'gateway_reidentified' }));
    process.exitCode = 1; await stop();
  }
  gatewayReady = true;
});
discord.client.on(Events.GuildCreate, guild => {
  guildWrites = guildWrites.then(async () => { if (!stopping) await rpc('registerGuild', [guild.id]); })
    .catch(async () => { report('guild_registration_failed', guild.id); process.exitCode = 1; await stop(); });
});
discord.client.on(Events.GuildDelete, guild => {
  guildWrites = guildWrites.then(async () => { if (!stopping) await rpc('forgetGuild', [guild.id]); })
    .catch(async () => { report('guild_cleanup_failed', guild.id); process.exitCode = 1; await stop(); });
});
discord.client.once(Events.ClientReady, client => {
  guildWrites = guildWrites.then(async () => {
    if (stopping) return;
    const current = new Set(client.guilds.cache.keys());
    const previous = await rpc<{ id: string }[]>('allGuilds', []);
    for (const guild of previous) if (!current.has(guild.id)) await rpc('forgetGuild', [guild.id]);
    for (const id of current) await rpc('registerGuild', [id]);
    await client.application.commands.create({ name: 'jevmod', description: 'Jev-Mod moderation controls',
      defaultMemberPermissions: PermissionFlagsBits.ManageGuild, contexts: [0],
      options: [{ type: 1, name: 'status', description: 'Show moderation mode and dashboard' }, { type: 1, name: 'pause', description: 'Pause moderation for this server' }] });
    initialized = !stopping;
  }).catch(async () => { console.error(JSON.stringify({ event: 'bot_initialization_failed' })); process.exitCode = 1; await stop(); });
});
discord.client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'jevmod' || !interaction.guildId) return;
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await discord.authorize(interaction.guildId, interaction.user.id);
    const policy = await store.getSettings(interaction.guildId);
    if (interaction.options.getSubcommand() === 'pause') {
      policy.settings.mode = 'off';
      await rpc('saveSettings', [interaction.guildId, policy.settings, policy.version, interaction.user.id]);
    }
    await interaction.editReply(`Jev-Mod: **${policy.settings.mode}**\n${config.PUBLIC_URL}`);
  } catch { if (interaction.deferred) await interaction.editReply('Request failed. Check your permissions and try again.').catch(() => {}); }
});

const inputSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('health'), args: z.tuple([]) }),
  z.object({ method: z.literal('authorize'), args: z.tuple([snowflake, snowflake]) }),
  z.object({ method: z.literal('metadata'), args: z.tuple([snowflake]) }),
  z.object({ method: z.literal('validateSettings'), args: z.tuple([snowflake, settingsSchema]) }),
  z.object({ method: z.literal('enforce'), args: z.tuple([z.object({ guildId: snowflake, channelId: snowflake, messageId: snowflake,
    hash: z.string().length(64), revision: z.string().min(1).max(64), action: z.literal('delete'), reason: z.string().max(500) })]) }),
]);
const server = createServer(async (request, response) => {
  response.setHeader('Content-Type', 'application/json');
  if (request.url === '/healthz') { response.end(JSON.stringify({ connected: initialized && discord.ready() })); return; }
  if (request.url !== '/rpc' || request.method !== 'POST') { response.writeHead(404).end('{}'); return; }
  if (config.INTERNAL_RPC_SECRET) {
    const supplied = Buffer.from(request.headers.authorization ?? '');
    const expected = Buffer.from(`Bearer ${config.INTERNAL_RPC_SECRET}`);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) { response.writeHead(401).end('{}'); return; }
  }
  try {
    if (!initialized) { response.writeHead(503).end('{}'); return; }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 65536) { response.writeHead(413).end('{}'); return; }
      chunks.push(chunk);
    }
    const input = inputSchema.parse(JSON.parse(Buffer.concat(chunks).toString()));
    let result;
    switch (input.method) {
      case 'health': result = { connected: discord.ready() }; break;
      case 'authorize': result = await discord.authorize(...input.args); break;
      case 'metadata': result = await discord.metadata(...input.args); break;
      case 'validateSettings': result = await discord.validateSettings(...input.args); break;
      case 'enforce': result = await discord.enforce(input.args[0]); break;
    }
    response.end(JSON.stringify({ result: result ?? null }));
  } catch (error) {
    const status = error instanceof z.ZodError ? 400 : (error as { status?: number }).status ?? 503;
    response.writeHead(status).end(JSON.stringify({ error: 'Bot request failed.' }));
  }
});
server.listen(8080, '0.0.0.0');
let disconnectedAt = Date.now();
const watchdog = setInterval(() => {
  if (discord.ready() && initialized) disconnectedAt = Date.now();
  else if (Date.now() - disconnectedAt > 180000) { process.exitCode = 1; stop(); }
}, 30000);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(watchdog); initialized = false; server.close(); await discord.stop();
}
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
discord.start().catch(async () => { console.error('Discord login failed.'); process.exitCode = 1; await stop(); });
