import { defaultSettings } from './policy.js';

// This store is used only by the loopback demo and automated tests, never by index.js.
export function memoryStore() {
  const policies = new Map();
  const cases = new Map();
  const audits = [];
  const oauthStates = new Map();
  let nextId = 0;
  return {
    async createOAuthState(sessionId, state, expires) { oauthStates.set(state, { sessionId, expires }); },
    async consumeOAuthState(sessionId, state) {
      const value = oauthStates.get(state);
      if (!value || value.sessionId !== sessionId || value.expires <= Date.now()) return false;
      oauthStates.delete(state);
      return true;
    },
    async getSettings(id) { return structuredClone(policies.get(id) ?? { settings: defaultSettings(), version: 0 }); },
    async saveSettings(id, settings, version, actor) {
      const current = await this.getSettings(id);
      if (current.version !== version) throw Object.assign(new Error('Settings changed. Reload before saving.'), { status: 409 });
      policies.set(id, structuredClone({ settings, version: version + 1 }));
      audits.unshift({ guild_id: id, actor_id: actor, event: `Saved settings; mode=${settings.mode}`, created_at: new Date().toISOString() });
      return this.getSettings(id);
    },
    async addCase(item) {
      if ([...cases.values()].some(row => row.guild_id === item.guildId && row.message_id === item.messageId
        && row.message_hash === item.messageHash && row.policy_version === item.policyVersion)) return null;
      const id = String(++nextId);
      cases.set(id, { id, guild_id: item.guildId, channel_id: item.channelId, message_id: item.messageId,
        author_id: item.authorId, message_hash: item.messageHash, policy_version: item.policyVersion,
        content: item.content, matches: item.matches, model: item.model, requested_action: item.requestedAction,
        outcome: item.outcome, created_at: new Date().toISOString() });
      return id;
    },
    async getCase(guild, id) { const row = cases.get(id); return row?.guild_id === guild ? structuredClone(row) : undefined; },
    async finishCase(guild, id, outcome, actor = null) {
      const row = cases.get(id);
      if (row?.guild_id === guild) Object.assign(row, { outcome, reviewed_by: actor });
    },
    async claimCase(guild, id, actor) {
      const row = cases.get(id);
      if (row?.guild_id !== guild || !['monitored', 'logged', 'delete_failed'].includes(row.outcome)) return false;
      Object.assign(row, { outcome: 'reviewing', reviewed_by: actor });
      return true;
    },
    async listCases(guild, before = '18446744073709551615') {
      return structuredClone([...cases.values()].filter(row => row.guild_id === guild && BigInt(row.id) < BigInt(before)).reverse().slice(0, 50));
    },
    async stats(guild) {
      const rows = [...cases.values()].filter(row => row.guild_id === guild);
      return { total: rows.length, removed: rows.filter(row => ['deleted', 'deleted_timed_out', 'deleted_timeout_failed', 'deleted_timeout_skipped'].includes(row.outcome)).length,
        review: rows.filter(row => ['monitored', 'logged', 'delete_failed'].includes(row.outcome)).length };
    },
    async audit(guild) { return audits.filter(row => row.guild_id === guild).slice(0, 20); },
  };
}

export const demoGuilds = [
  { id: '100000000000000001', name: 'The Commons' },
  { id: '100000000000000002', name: 'Developer Lounge' },
];
export function demoDiscord() {
  return {
    installed: id => demoGuilds.some(guild => guild.id === id),
    async authorize(id) {
      if (!this.installed(id)) throw Object.assign(new Error('You cannot manage this server.'), { status: 403 });
    },
    async metadata(id) {
      return { ...demoGuilds.find(guild => guild.id === id),
        channels: [{ id: '200000000000000001', name: 'general' }, { id: '200000000000000002', name: 'mod-log' }, { id: '200000000000000003', name: 'off-topic' }],
        roles: [{ id: '300000000000000001', name: 'Moderators' }, { id: '300000000000000002', name: 'Members' }],
        permissions: { manageMessages: true, moderateMembers: true } };
    },
    async validateSettings() {},
    async enforce() { return 'demo_no_action'; },
    async logCase() {},
  };
}
