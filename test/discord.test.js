import test from 'node:test';
import assert from 'node:assert/strict';
import { ChannelType, Events, Guild, PermissionFlagsBits, Routes, Status } from 'discord.js';
import { createDiscord } from '../apps/bot/src/discord.js';
import { messageHash } from '../packages/core/src/moderation.js';
import { defaultSettings } from '../packages/core/src/policy.ts';

function setup({ memberFailure = false, editDuringLookup = false, pauseDuringDelete = false, editDuringPolicy = false, policyFailureAt = 0, disconnectDuringPolicy = false, revisionDuringLookup = false } = {}) {
  const adapter = createDiscord('not-a-live-token');
  let content = 'scam';
  let current = true;
  let deletes = 0;
  let timeouts = 0;
  let policyChecks = 0;
  let editedTimestamp = null;
  adapter.client.ws.status = Status.Ready;
  adapter.client.ws.shards.set(0, { status: Status.Ready });
  const member = { roles: { cache: { some: () => false } }, moderatable: true, timeout: async () => { timeouts++; } };
  const channel = { guildId: 'guild', isTextBased: () => true, messages: { fetch: async () => ({
    content, editedTimestamp, author: { id: 'member' }, deletable: true,
    delete: async () => { deletes++; if (pauseDuringDelete) current = false; },
  }) } };
  adapter.client.guilds.cache.set('guild', { channels: { fetch: async () => channel }, members: { fetch: async () => {
    if (memberFailure) throw new Error('temporary failure');
    if (editDuringLookup) content = 'clean';
    if (revisionDuringLookup) editedTimestamp = 1000;
    return member;
  } } });
  return { adapter, counts: () => ({ deletes, timeouts }), request: {
    guildId: 'guild', channelId: 'channel', messageId: 'message', revision: 'created', hash: messageHash('scam'), action: 'timeout',
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
  adapter.client.guilds.cache.set('guild', {});
  adapter.client.rest.get = async route => {
    if (route === Routes.guildMember('guild', 'moderator')) {
      lookups++;
      if (disconnectDuringLookup) shard.status = Status.Connecting;
      return { roles: ['managers'] };
    }
    if (route === Routes.guildRoles('guild')) return [{ id: 'managers', permissions: String(PermissionFlagsBits.ManageGuild) }];
    if (route === Routes.guild('guild')) return { owner_id: 'owner' };
    throw new Error(`Unexpected route: ${route}`);
  };
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

test('new revisions with identical text and legacy revisions cannot receive stale punishment', async t => {
  const { adapter, request, counts } = setup({ revisionDuringLookup: true });
  t.after(() => adapter.stop());
  assert.equal(await adapter.enforce(request), 'message_changed');
  assert.equal(await adapter.enforce({ ...request, revision: 'legacy:1' }), 'message_changed');
  assert.deepEqual(counts(), { deletes: 0, timeouts: 0 });
  assert.equal(await adapter.enforce({ ...request, revision: '1000' }), 'deleted_timed_out');
  assert.deepEqual(counts(), { deletes: 1, timeouts: 1 });
});

test('snapshot records the actual Discord revision independently of message text', async t => {
  const adapter = createDiscord('not-a-live-token');
  t.after(() => adapter.stop());
  const message = { id: 'message', guildId: 'guild', channelId: 'channel', channel: { parentId: null },
    author: { id: 'author', bot: false }, content: 'same text', editedTimestamp: null,
    mentions: { users: new Map(), roles: new Map(), everyone: false },
    guild: { members: { fetch: async () => ({ roles: { cache: new Map() } }) } } };
  assert.equal((await adapter.snapshot(message)).revision, 'created');
  message.editedTimestamp = 1000;
  assert.equal((await adapter.snapshot(message)).revision, '1000');
});

test('authorization ignores stale SDK roles overwritten by an older metadata response', async t => {
  const adapter = createDiscord('not-a-live-token');
  t.after(() => adapter.stop());
  adapter.client.ws.status = Status.Ready;
  adapter.client.ws.shards.set(0, { status: Status.Ready });
  const guildId = '100000000000000001';
  const roleId = '200000000000000001';
  const userId = '300000000000000001';
  const role = { id: roleId, name: 'Moderator', permissions: String(PermissionFlagsBits.ManageGuild) };
  const guild = new Guild(adapter.client, { id: guildId, name: 'Test', owner_id: 'owner',
    roles: [{ id: guildId, name: '@everyone', permissions: '0' }, role], channels: [] });
  adapter.client.guilds.cache.set(guildId, guild);
  guild.channels.fetch = async () => guild.channels.cache;
  guild.members.fetchMe = async () => ({ permissions: { has: () => true } });
  const started = Promise.withResolvers();
  const pending = Promise.withResolvers();
  let roleReads = 0;
  adapter.client.rest.get = async route => {
    if (route === Routes.guildRoles(guildId)) {
      if (++roleReads === 1) { started.resolve(); return pending.promise; }
      return [{ ...role, permissions: '0' }, { id: guildId, permissions: '0' }];
    }
    if (route === Routes.guildMember(guildId, userId)) return { user: { id: userId, username: 'moderator' }, roles: [roleId] };
    if (route === Routes.guild(guildId)) return { owner_id: 'owner' };
    throw new Error(`Unexpected route: ${route}`);
  };
  const metadata = adapter.metadata(guildId);
  await started.promise;
  adapter.client.actions.GuildRoleUpdate.handle({ guild_id: guildId, role: { ...role, permissions: '0' } });
  assert.equal(guild.roles.cache.get(roleId).permissions.has(PermissionFlagsBits.ManageGuild), false);
  pending.resolve([role, { id: guildId, name: '@everyone', permissions: '0' }]);
  await metadata;
  assert.equal(guild.roles.cache.get(roleId).permissions.has(PermissionFlagsBits.ManageGuild), true);
  await assert.rejects(adapter.authorize(guildId, userId), error => error.status === 403);
});

test('authorization uses current membership, ownership, and everyone or administrator permissions', async t => {
  const adapter = createDiscord('not-a-live-token');
  t.after(() => adapter.stop());
  adapter.client.ws.status = Status.Ready;
  adapter.client.ws.shards.set(0, { status: Status.Ready });
  adapter.client.guilds.cache.set('guild', { ownerId: 'user' });
  let owner = 'other';
  let memberRoles = ['managers'];
  let roleId = 'managers';
  let permission = PermissionFlagsBits.ManageGuild;
  let failMembership = false;
  adapter.client.rest.get = async route => {
    if (route === Routes.guildMember('guild', 'user')) {
      if (failMembership) throw new Error('member left');
      return { roles: memberRoles };
    }
    if (route === Routes.guildRoles('guild')) return [{ id: roleId, permissions: String(permission) }];
    if (route === Routes.guild('guild')) return { owner_id: owner };
    throw new Error(`Unexpected route: ${route}`);
  };
  await adapter.authorize('guild', 'user');
  memberRoles = [];
  await assert.rejects(adapter.authorize('guild', 'user'), error => error.status === 403);
  roleId = 'guild';
  await adapter.authorize('guild', 'user');
  roleId = 'managers';
  memberRoles = ['managers'];
  permission = PermissionFlagsBits.Administrator;
  await adapter.authorize('guild', 'user');
  permission = 0n;
  owner = 'user';
  await adapter.authorize('guild', 'user');
  owner = 'other';
  await assert.rejects(adapter.authorize('guild', 'user'), error => error.status === 403);
  owner = 'user';
  failMembership = true;
  await assert.rejects(adapter.authorize('guild', 'user'), error => error.status === 403);
});
