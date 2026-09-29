import test from 'node:test';
import assert from 'node:assert/strict';
import { ChannelType, Events, Guild, Status } from 'discord.js';
import { createDiscord } from '../apps/bot/src/discord.js';
import { messageHash } from '../packages/core/src/moderation.js';
import { defaultSettings } from '../packages/core/src/policy.ts';

function setup({ memberFailure = false, editDuringLookup = false, pauseDuringDelete = false, editDuringPolicy = false, policyFailureAt = 0, disconnectDuringPolicy = false } = {}) {
  const adapter = createDiscord('not-a-live-token');
  let content = 'scam';
  let current = true;
  let deletes = 0;
  let timeouts = 0;
  let policyChecks = 0;
  adapter.client.ws.status = Status.Ready;
  adapter.client.ws.shards.set(0, { status: Status.Ready });
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
      if (++policyChecks === policyFailureAt) throw new Error('policy unavailable');
      if (disconnectDuringPolicy) adapter.client.ws.shards.get(0).status = Status.Resuming;
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
test('policy failures after deletion preserve the deletion outcome without a timeout', async t => {
  for (const policyFailureAt of [2, 3]) {
    const { adapter, request, counts } = setup({ policyFailureAt });
    t.after(() => adapter.stop());
    assert.equal(await adapter.enforce(request), 'deleted_timeout_failed');
    assert.deepEqual(counts(), { deletes: 1, timeouts: 0 });
  }
});
test('forum parents are selectable exemptions but cannot receive moderation logs', async t => {
  const adapter = createDiscord('not-a-live-token');
  t.after(() => adapter.stop());
  adapter.client.ws.status = Status.Ready;
  adapter.client.ws.shards.set(0, { status: Status.Ready });
  const guild = new Guild(adapter.client, { id: '100000000000000001', name: 'Test', roles: [], channels: [
    { id: '200000000000000001', name: 'general', type: ChannelType.GuildText },
    { id: '200000000000000002', name: 'forum', type: ChannelType.GuildForum },
    { id: '200000000000000003', name: 'media', type: ChannelType.GuildMedia },
    { id: '200000000000000004', name: 'category', type: ChannelType.GuildCategory },
  ] });
  adapter.client.guilds.cache.set(guild.id, guild);
  guild.channels.fetch = async () => guild.channels.cache;
  guild.roles.fetch = async () => guild.roles.cache;
  guild.members.fetchMe = async () => ({ permissions: { has: () => true } });
  assert.deepEqual((await adapter.metadata(guild.id)).channels, [
    { id: '200000000000000001', name: 'general', sendable: true },
    { id: '200000000000000002', name: 'forum', sendable: false },
    { id: '200000000000000003', name: 'media', sendable: false },
  ]);
  const settings = { ...defaultSettings(), exemptChannels: ['200000000000000002'] };
  await adapter.validateSettings(guild.id, settings);
  await assert.rejects(adapter.validateSettings(guild.id, { ...settings, logChannelId: '200000000000000002' }),
    error => error.status === 400);
});
test('disconnected shards block stale authorization and readiness until resume completes', async t => {
  const adapter = createDiscord('not-a-live-token');
  t.after(() => adapter.stop());
  adapter.client.ws.status = Status.Ready;
  const shard = { status: Status.Ready };
  adapter.client.ws.shards.set(0, shard);
  let disconnectDuringLookup = false;
  let lookups = 0;
  adapter.client.guilds.cache.set('guild', { ownerId: 'owner', members: { fetch: async () => {
    lookups++;
    if (disconnectDuringLookup) shard.status = Status.Connecting;
    return { permissions: { has: () => true } };
  } } });
  await adapter.authorize('guild', 'moderator');
  assert.equal(adapter.ready(), true);
  for (const status of [Status.Disconnected, Status.Connecting, Status.Identifying, Status.WaitingForGuilds, Status.Resuming]) {
    shard.status = status;
    assert.equal(adapter.client.isReady(), true);
    assert.equal(adapter.ready(), false);
    await assert.rejects(adapter.authorize('guild', 'moderator'), error => error.status === 503);
  }
  assert.equal(lookups, 1);
  shard.status = Status.Ready;
  assert.equal(adapter.ready(), true);
  disconnectDuringLookup = true;
  await assert.rejects(adapter.authorize('guild', 'moderator'), error => error.status === 503);
  adapter.client.ws.shards.clear();
  assert.equal(adapter.ready(), false);
});
test('a disconnect during the final policy check prevents deletion', async t => {
  const { adapter, request, counts } = setup({ disconnectDuringPolicy: true });
  t.after(() => adapter.stop());
  assert.equal(await adapter.enforce(request), 'delete_failed');
  assert.deepEqual(counts(), { deletes: 0, timeouts: 0 });
});
