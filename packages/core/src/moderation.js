import { createHash } from 'node:crypto';
import { isExempt, localMatches, strongestAction } from './policy.ts';

export const messageHash = text => createHash('sha256').update(text).digest('hex');

export function createModerator({ store, classify, discord, report = (_event, _guildId) => {} }) {
  return async function moderate(message) {
    const { settings, version } = await store.getSettings(message.guildId);
    if (isExempt(message, settings) || !message.content.trim()) return;
    const local = localMatches(message, settings);
    let decision;
    try { decision = await classify(message.content, settings.rules); }
    catch { report('classification_failed', message.guildId); return; }
    const matches = [...local, ...decision.matches];
    if (!matches.length) return;
    const hash = messageHash(message.content);
    const requestedAction = strongestAction(matches);
    const id = await store.addCase({ ...message, messageId: message.id, messageHash: hash,
      policyVersion: version, matches, model: decision.model, requestedAction, outcome: 'pending' });
    if (!id) return;

    let outcome;
    if (settings.mode === 'monitor') outcome = 'monitored';
    else if (requestedAction === 'log') outcome = 'logged';
    else {
      const current = await store.getSettings(message.guildId);
      if (current.version !== version || current.settings.mode !== 'protect') outcome = 'policy_changed';
      else {
        try {
          outcome = await discord.enforce({ guildId: message.guildId, channelId: message.channelId,
            messageId: message.id, hash, action: requestedAction, timeoutMinutes: settings.timeoutMinutes,
            exemptRoles: current.settings.exemptRoles, exemptChannels: current.settings.exemptChannels,
            isCurrent: async () => {
              const latest = await store.getSettings(message.guildId);
              return latest.version === version && latest.settings.mode === 'protect';
            },
            reason: `Jev-Mod case ${id}: ${matches.map(match => match.name).join(', ')}` });
        } catch { outcome = 'delete_failed'; }
      }
    }
    await store.finishCase(message.guildId, id, outcome);
    if (settings.logChannelId) {
      try { await discord.logCase(message.guildId, settings.logChannelId, { id, outcome, matches, authorId: message.authorId }); }
      catch { report('log_channel_failed', message.guildId); }
    }
    return { id, outcome };
  };
}

export function createQueue(worker, { concurrency = 6, maxPending = 100, perGuildPerMinute = 60, onError = (_event, _guildId) => {} } = {}) {
  const pending = [];
  const budgets = new Map();
  let active = 0;
  function drain() {
    while (active < concurrency && pending.length) {
      const message = pending.shift();
      active++;
      Promise.resolve().then(() => worker(message)).catch(() => onError('processing_failed', message.guildId))
        .finally(() => { active--; drain(); });
    }
  }
  return message => {
    const minute = Math.floor(Date.now() / 60000);
    for (const [id, budget] of budgets) if (budget.minute !== minute) budgets.delete(id);
    const budget = budgets.get(message.guildId) ?? { minute, used: 0 };
    if (budget.used >= perGuildPerMinute || pending.length >= maxPending
      || pending.filter(item => item.guildId === message.guildId).length >= 10) {
      onError('capacity_skipped', message.guildId);
      return false;
    }
    budget.used++;
    budgets.set(message.guildId, budget);
    pending.push(message);
    drain();
    return true;
  };
}
