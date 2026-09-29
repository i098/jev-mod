import { Client, Events, GatewayIntentBits, Partials, PermissionFlagsBits, ActivityType, Routes, Status } from 'discord.js';
import { messageHash } from '@jev-mod/core/moderation.js';

const MANAGE = PermissionFlagsBits.ManageGuild;
const messageRevision = message => message.editedTimestamp == null ? 'created' : String(message.editedTimestamp);
const matchesRevision = (message, revision, hash) => !message.partial && messageRevision(message) === revision && messageHash(message.content) === hash;
const messageChanged = (before, after) => before.partial || !matchesRevision(after, messageRevision(before), messageHash(before.content));
export function createDiscord(token) {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
    partials: [Partials.Message, Partials.Channel],
    allowedMentions: { parse: [] },
    presence: { activities: [{ name: 'your server rules', type: ActivityType.Watching }] },
    sweepers: { messages: { interval: 300, lifetime: 600 } },
  });
  const watching = new Map();
  client.on(Events.MessageUpdate, (before, after) => {
    if (!messageChanged(before, after)) return;
    for (const watch of watching.get(after.id) ?? []) watch.changed = true;
  });
  const ready = () => client.isReady() && client.ws.shards.size > 0 && client.ws.shards.every(shard => shard.status === Status.Ready);
  async function guildFor(id) {
    if (!ready()) throw Object.assign(new Error('Discord is reconnecting. Try again shortly.'), { status: 503 });
    const guild = client.guilds.cache.get(id);
    if (!guild) throw Object.assign(new Error('Add Jev-Mod to this server first.'), { status: 404 });
    return guild;
  }
  return {
    client,
    ready,
    async start() { await client.login(token); },
    async stop() { await client.destroy(); },
    onMessage(callback) {
      client.on(Events.MessageCreate, message => {
        if (message.guildId && !message.author?.bot) callback(message);
      });
      client.on(Events.MessageUpdate, (before, after) => {
        if (after.guildId && !after.author?.bot && messageChanged(before, after)) callback(after);
      });
    },
    async snapshot(input) {
      const message = input.partial ? await input.fetch() : input;
      const member = await message.guild.members.fetch({ user: message.author.id, force: true });
      return { id: message.id, revision: messageRevision(message), guildId: message.guildId, channelId: message.channelId,
        parentId: message.channel.parentId, authorId: message.author.id, bot: message.author.bot,
        roleIds: [...member.roles.cache.keys()], content: message.content,
        mentionCount: message.mentions.users.size + message.mentions.roles.size + (message.mentions.everyone ? 1 : 0) };
    },
    async authorize(guildId, userId) {
      await guildFor(guildId);
      let member, roles, guild;
      try {
        [member, roles, guild] = await Promise.all([
          client.rest.get(Routes.guildMember(guildId, userId)),
          client.rest.get(Routes.guildRoles(guildId)),
          client.rest.get(Routes.guild(guildId)),
        ]);
      }
      catch { throw Object.assign(new Error('You cannot manage this server.'), { status: 403 }); }
      await guildFor(guildId);
      const permissions = roles.filter(role => role.id === guildId || member.roles.includes(role.id))
        .reduce((bits, role) => bits | BigInt(role.permissions), 0n);
      if (guild.owner_id !== userId && (permissions & (MANAGE | PermissionFlagsBits.Administrator)) === 0n) {
        throw Object.assign(new Error('Manage Server permission is required.'), { status: 403 });
      }
    },
    async metadata(guildId) {
      const guild = await guildFor(guildId);
      const [channels, roles, me] = await Promise.all([guild.channels.fetch(), guild.roles.fetch(), guild.members.fetchMe()]);
      return {
        id: guild.id, name: guild.name,
        channels: [...channels.values()].filter(channel => channel && (channel.isTextBased() || channel.isThreadOnly()) && !channel.isDMBased())
          .map(channel => ({ id: channel.id, name: channel.name, sendable: channel.isSendable() })),
        roles: [...roles.values()].filter(role => role.id !== guild.id && !role.managed).map(role => ({ id: role.id, name: role.name })),
        permissions: { manageMessages: me.permissions.has(PermissionFlagsBits.ManageMessages),
          moderateMembers: me.permissions.has(PermissionFlagsBits.ModerateMembers) },
      };
    },
    async validateSettings(guildId, settings) {
      const guild = await guildFor(guildId);
      const channels = await guild.channels.fetch();
      const roles = await guild.roles.fetch();
      if (settings.exemptChannels.some(id => !channels.has(id)) || settings.exemptRoles.some(id => !roles.has(id))) {
        throw Object.assign(new Error('Choose channels and roles from this server.'), { status: 400 });
      }
      if (settings.logChannelId) {
        const channel = channels.get(settings.logChannelId);
        const me = await guild.members.fetchMe();
        if (!channel?.isSendable() || !channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
          throw Object.assign(new Error('Jev-Mod cannot send to the selected log channel.'), { status: 400 });
        }
      }
    },
    /** @param {{guildId: string, channelId: string, messageId: string, revision: string, hash: string, action: string, timeoutMinutes?: number, reason: string, exemptRoles?: string[], exemptChannels?: string[], isCurrent?: () => Promise<boolean>}} input */
    async enforce({ guildId, channelId, messageId, revision, hash, action, timeoutMinutes = 10, reason,
      exemptRoles = [], exemptChannels = [], isCurrent = async () => true }) {
      const watch = { changed: false };
      const watchers = watching.get(messageId) ?? new Set();
      watchers.add(watch);
      watching.set(messageId, watchers);
      try {
      const guild = await guildFor(guildId);
      const channel = await guild.channels.fetch(channelId);
      if (!channel?.isTextBased() || channel.guildId !== guildId) return 'delete_failed';
      let message;
      try { message = await channel.messages.fetch({ message: messageId, force: true, cache: false }); }
      catch (error) { if (error.code === 10008) return 'already_gone'; throw error; }
      if (!matchesRevision(message, revision, hash)) return 'message_changed';
      let member;
      try { member = await guild.members.fetch({ user: message.author.id, force: true }); }
      catch { return 'member_check_failed'; }
      if (exemptChannels.includes(channelId) || exemptChannels.includes(channel.parentId)
        || member?.roles.cache.some(role => exemptRoles.includes(role.id))) return 'exempt';
      // Refresh after the member lookup; an earlier uncached snapshot does not track edits.
      try { message = await channel.messages.fetch({ message: messageId, force: true, cache: false }); }
      catch (error) { if (error.code === 10008) return 'already_gone'; throw error; }
      if (!matchesRevision(message, revision, hash)) return 'message_changed';
      if (!await isCurrent()) return 'policy_changed';
      if (watch.changed) return 'message_changed';
      if (!ready()) return 'delete_failed';
      if (!message.deletable) return 'missing_permission';
      await message.delete();
      if (action !== 'timeout') return 'deleted';
      try {
        if (!await isCurrent()) return 'deleted_timeout_skipped';
        member = await guild.members.fetch({ user: message.author.id, force: true });
        if (member.roles.cache.some(role => exemptRoles.includes(role.id)) || !await isCurrent()) return 'deleted_timeout_skipped';
        if (!ready()) return 'deleted_timeout_skipped';
        if (!member.moderatable) return 'deleted_timeout_failed';
        await member.timeout(timeoutMinutes * 60000, reason.slice(0, 500));
        return 'deleted_timed_out';
      } catch { return 'deleted_timeout_failed'; }
      } finally {
        watchers.delete(watch);
        if (!watchers.size) watching.delete(messageId);
      }
    },
    async logCase(guildId, channelId, item) {
      const guild = await guildFor(guildId);
      const channel = await guild.channels.fetch(channelId);
      if (!channel?.isSendable() || channel.guildId !== guildId) throw new Error('LOG_CHANNEL_UNAVAILABLE');
      await channel.send({ content: `**Jev-Mod · Case #${item.id}**\nOutcome: ${item.outcome}\nMember: ${item.authorId}\nRules: ${item.matches.map(match => match.name).join(', ')}`, allowedMentions: { parse: [] } });
    },
  };
}
