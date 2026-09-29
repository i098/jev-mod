import test from 'node:test';
import assert from 'node:assert/strict';
import { Events } from 'discord.js';
import { createDiscord } from '../apps/bot/src/discord.js';
import { messageHash } from '../packages/core/src/moderation.js';

function setup({ memberFailure = false, editDuringLookup = false, pauseDuringDelete = false, editDuringPolicy = false } = {}) {
  const adapter = createDiscord('not-a-live-token');
  let content = 'scam';
  let current = true;
  let deletes = 0;
  let timeouts = 0;
  adapter.client.isReady = () => true;
  const member = { roles: { cache: { some: () => false } }, moderatable: true, timeout: async () => { timeouts++; } };
  const channel = { guildId: 'guild', isTextBased: () => true, messages: { fetch: async () => ({
    content, author: { id: 'member' }, deletable: true,
    delete: async () => { deletes++; if (pauseDuringDelete) current = false; },
  }) } };
  adapter.client.guilds.cache.set('guild', { channels: { fetch: async () => channel }, members: { fetch: async () => {
    if (memberFailure) throw new Error('temporary failure');
    if (editDuringLookup) content = 'clean';
    return member;
  } } });
  return { adapter, counts: () => ({ deletes, timeouts }), request: {
    guildId: 'guild', channelId: 'channel', messageId: 'message', hash: messageHash('scam'), action: 'timeout',
    timeoutMinutes: 10, reason: 'test', exemptRoles: ['exempt'], isCurrent: async () => {
      if (editDuringPolicy) adapter.client.emit(Events.MessageUpdate, { content: 'scam' }, { id: 'message', content: 'clean' });
      return current;
    },
  } };
}
test('member lookup failure cannot bypass role exemptions', async t => {
  const { adapter, request, counts } = setup({ memberFailure: true });
  t.after(() => adapter.stop());
  assert.equal(await adapter.enforce(request), 'member_check_failed');
  assert.deepEqual(counts(), { deletes: 0, timeouts: 0 });
});
test('edits during member or policy checks cannot delete a clean message', async t => {
  for (const option of ['editDuringLookup', 'editDuringPolicy']) {
    const { adapter, request, counts } = setup({ [option]: true });
    t.after(() => adapter.stop());
    assert.equal(await adapter.enforce(request), 'message_changed');
    assert.deepEqual(counts(), { deletes: 0, timeouts: 0 });
  }
});
test('pausing during deletion prevents the subsequent timeout', async t => {
  const { adapter, request, counts } = setup({ pauseDuringDelete: true });
  t.after(() => adapter.stop());
  assert.equal(await adapter.enforce(request), 'deleted_timeout_skipped');
  assert.deepEqual(counts(), { deletes: 1, timeouts: 0 });
});
