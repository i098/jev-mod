import { defaultSettings } from '../packages/core/src/policy.ts';

export function memoryStore() {
  const policies = new Map();
  const cases = new Map();
  let nextId = 0;
  return {
    async getSettings(id) { return structuredClone(policies.get(id) ?? { settings: defaultSettings(), version: 0 }); },
    async saveSettings(id, settings, version) {
      const current = await this.getSettings(id);
      if (current.version !== version) throw Object.assign(new Error('Settings changed. Reload before saving.'), { status: 409 });
      policies.set(id, structuredClone({ settings, version: version + 1 }));
      return this.getSettings(id);
    },
    async addCase(item) {
      if ([...cases.values()].some(row => row.guild_id === item.guildId && row.message_id === item.messageId
        && row.message_revision === item.messageRevision && row.policy_version === item.policyVersion)) return null;
      const id = String(++nextId);
      cases.set(id, { id, guild_id: item.guildId, message_id: item.messageId,
        message_revision: item.messageRevision, policy_version: item.policyVersion, outcome: item.outcome });
      return id;
    },
    async finishCase(guild, id, outcome) {
      const row = cases.get(id);
      if (row?.guild_id === guild) row.outcome = outcome;
    },
    async listCases(guild) { return structuredClone([...cases.values()].filter(row => row.guild_id === guild)); },
  };
}
