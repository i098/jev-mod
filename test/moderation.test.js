import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { createModerator, createQueue } from '../packages/core/src/moderation.js';
import { memoryStore } from './fixtures.js';
import { defaultSettings } from '../packages/core/src/policy.ts';

const message = { id: 'msg', guildId: 'guild', channelId: 'channel', authorId: 'member', revision: 'created', content: 'scam message', roleIds: [], mentionCount: 0 };
const decision = { model: 'test', matches: [{ id: 'scams', name: 'Scams', probability: 0.95, action: 'delete' }] };

test('monitor records once; protect acts once; current content hash reaches the adapter', async () => {
  const store = memoryStore();
  let deletes = 0;
  const moderate = createModerator({ store, classify: async () => decision,
    discord: { enforce: async request => { assert.equal(request.hash.length, 64); deletes++; return 'deleted'; } } });
  assert.equal((await moderate(message)).outcome, 'monitored');
  await moderate(message);
  assert.equal((await store.listCases('guild')).length, 1);
  assert.equal(deletes, 0);
  await store.saveSettings('guild', { ...defaultSettings(), mode: 'protect' }, 0, 'admin');
  assert.equal((await moderate(message)).outcome, 'deleted');
  await moderate(message);
  assert.equal(deletes, 1);
});

test('provider errors, exemptions, and policy changes never delete', async () => {
  const store = memoryStore();
  const discord = { enforce: () => assert.fail('must not delete') };
  await store.saveSettings('guild', { ...defaultSettings(), mode: 'protect' }, 0, 'admin');
  const fail = createModerator({ store, discord, classify: async () => { throw new Error('outage'); } });
  await fail(message);
  assert.equal((await store.listCases('guild')).length, 0);
  const change = createModerator({ store, discord, classify: async () => {
    await store.saveSettings('guild', { ...defaultSettings(), mode: 'off' }, 1, 'admin');
    return decision;
  } });
  assert.equal((await change(message)).outcome, 'policy_changed');
  const off = createModerator({ store, discord, classify: () => assert.fail('disabled policy must not call Jev') });
  await off(message);
});

test('bounded queue rejects excess work without exceeding worker concurrency', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let calls = 0;
  const enqueue = createQueue(async () => { calls++; await gate; }, { concurrency: 1, maxPending: 1, perGuildPerMinute: 2 });
  assert.equal(enqueue(message), true);
  assert.equal(enqueue(message), true);
  assert.equal(enqueue(message), false);
  await setImmediate();
  assert.equal(calls, 1);
  release();
  await setImmediate();
  assert.equal(calls, 2);
});
test('restoring flagged content in a new revision is moderated again', async () => {
  const store = memoryStore();
  await store.saveSettings('guild', { ...defaultSettings(), mode: 'protect' }, 0, 'admin');
  let calls = 0;
  const moderate = createModerator({ store, classify: async () => decision,
    discord: { enforce: async request => { calls++; return request.revision === 'created' ? 'message_changed' : 'deleted'; } } });
  assert.equal((await moderate(message)).outcome, 'message_changed');
  assert.equal((await moderate({ ...message, revision: '1000' })).outcome, 'deleted');
  assert.equal(await moderate({ ...message, revision: '1000' }), undefined);
  assert.equal(calls, 2);
});
