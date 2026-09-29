import mysql from 'mysql2/promise';
import { Events, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { readConfig } from './config.js';
import { createStore, MysqlSessionStore } from './store.js';
import { createDiscord } from './discord.js';
import { createJev } from './jev.js';
import { createModerator, createQueue } from './moderation.js';
import { createApp } from './app.js';

async function main() {
  const config = readConfig();
  const pool = mysql.createPool({ uri: config.DATABASE_URL, connectionLimit: 8, waitForConnections: true,
    queueLimit: 100, supportBigNumbers: true, bigNumberStrings: true,
    ...(config.DATABASE_TLS === 'true' ? { ssl: { rejectUnauthorized: true } } : {}),
  });
  // Startup only checks the schema; applying schema.sql is an explicit operator step.
  try {
    await pool.execute('SELECT guild_id FROM guild_settings LIMIT 1');
    await pool.execute('SELECT state_hash FROM oauth_states LIMIT 1');
  } catch (error) { await pool.end(); throw error; }
  const store = createStore(pool);
  const discord = createDiscord(config.DISCORD_BOT_TOKEN);
  const classify = createJev({ key: config.TYPESAFE_API_KEY, model: config.JEV_MODEL, requestsPerMinute: config.JEV_GLOBAL_REQUESTS_PER_MINUTE });
  const failures = new Map();
  function report(event, guildId) {
    failures.set(guildId, { event, at: new Date().toISOString() });
    console.warn(JSON.stringify({ event, guildId }));
  }
  const moderate = createModerator({ store, classify, discord, report });
  const enqueue = createQueue(async input => moderate(await discord.snapshot(input)), {
    perGuildPerMinute: config.JEV_REQUESTS_PER_MINUTE, onError: report,
  });
  discord.onMessage(enqueue);
  discord.client.on(Events.Error, () => console.error(JSON.stringify({ event: 'discord_connection_error' })));
  discord.client.on(Events.GuildDelete, guild => {
    failures.delete(guild.id);
    store.forgetGuild(guild.id).catch(() => report('guild_cleanup_failed', guild.id));
  });
  discord.client.once(Events.ClientReady, async client => {
    console.log(JSON.stringify({ event: 'discord_ready', guildCount: client.guilds.cache.size }));
    try {
      await client.application.commands.create({ name: 'jevmod', description: 'Jev-Mod moderation controls',
        defaultMemberPermissions: PermissionFlagsBits.ManageGuild, contexts: [0],
        options: [{ name: 'status', description: 'Show the moderation mode and dashboard link', type: 1 },
          { name: 'pause', description: 'Disable moderation for this server', type: 1 }] });
    } catch { console.error(JSON.stringify({ event: 'command_registration_failed' })); }
  });
  discord.client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== 'jevmod' || !interaction.guildId) return;
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await discord.authorize(interaction.guildId, interaction.user.id);
      let { settings, version } = await store.getSettings(interaction.guildId);
      if (interaction.options.getSubcommand() === 'pause') {
        settings = { ...settings, mode: 'off' };
        await store.saveSettings(interaction.guildId, settings, version, interaction.user.id);
      }
      await interaction.editReply(`Jev-Mod mode: **${settings.mode}**\nDashboard: ${config.PUBLIC_URL}`);
    } catch {
      if (interaction.deferred) await interaction.editReply('Request failed. Check your permissions and try again.').catch(() => {});
    }
  });
  const app = createApp({ config, store, discord, classify,
    sessionStore: new MysqlSessionStore(pool, config.SESSION_SECRET),
    health: guildId => ({ connected: discord.ready(), lastIssue: failures.get(guildId) ?? null }),
  });
  let cleanup;
  let stopping = false;
  const server = app.listen(config.PORT, config.HOST, () => console.log(`Jev-Mod dashboard: ${config.PUBLIC_URL}`));
  server.on('error', () => { console.error('Dashboard could not bind to its port.'); process.exitCode = 1; shutdown(); });
  async function shutdown() {
    if (stopping) return;
    stopping = true;
    clearInterval(cleanup);
    server.close();
    await discord.stop();
    await pool.end();
  }
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  try {
    await store.cleanup();
    cleanup = setInterval(() => store.cleanup().catch(() => console.error('Retention cleanup failed.')), 3600000);
    cleanup.unref();
    await discord.start();
  }
  catch { await shutdown(); throw new Error('Discord login failed. Check the bot token and Message Content Intent.'); }
}

main().catch(error => {
  const safe = /^(Missing or invalid configuration|PUBLIC_URL|Production PUBLIC_URL|Discord login failed)/.test(error.message);
  console.error(safe ? error.message : 'Jev-Mod startup failed. Check database access and apply sql/schema.sql to a new database.');
  process.exitCode = 1;
});
