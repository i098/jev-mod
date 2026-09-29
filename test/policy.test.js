import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultSettings, settingsSchema, isExempt, localMatches, canManage } from '../packages/core/src/policy.ts';
import { createJev } from '../packages/core/src/jev.ts';

test('policy validates bounds and requires one of every rule', () => {
  const settings = defaultSettings();
  assert.equal(settingsSchema.parse(settings).mode, 'monitor');
  assert.equal(settingsSchema.safeParse({ ...settings, timeoutMinutes: 50000 }).success, false);
  assert.equal(settingsSchema.safeParse({ ...settings, rules: Array(6).fill(settings.rules[0]) }).success, false);
  assert.equal(canManage({ permissions: '32' }), true);
  assert.equal(canManage({ permissions: '1024' }), false);
  assert.equal(canManage({ permissions: 'invalid' }), false);
});

test('channel parents and roles are exempt; local rules normalize text', () => {
  const settings = { ...defaultSettings(), exemptChannels: ['parent'], blockedPhrases: ['bad phrase'] };
  const message = { guildId: 'guild', channelId: 'thread', parentId: 'parent', roleIds: [], content: 'ＢＡＤ PHRASE', mentionCount: 0 };
  assert.equal(isExempt(message, settings), true);
  assert.equal(localMatches(message, settings)[0].id, 'phrases');
});

test('Jev uses documented Noul answers and validates all enabled answers before acting', async () => {
  let payload;
  const rules = defaultSettings().rules.map((rule, index) => ({ ...rule, enabled: index === 0 }));
  const classify = createJev({ key: 'test', fetcher: async (url, options) => {
    assert.equal(url, 'https://api.typesafe.ai/v1/systemone');
    payload = JSON.parse(options.body);
    return Response.json({ model: 'jev-1.13.0', answers: { scams: { type: 'noul', noul: 0.95 } } });
  } });
  assert.equal((await classify('test content', rules)).matches.length, 1);
  assert.deepEqual(payload.state, { message: 'test content' });
  const invalid = createJev({ key: 'test', fetcher: async () => Response.json({ model: 'test', answers: { scams: { type: 'noul', noul: '0.99' } } }) });
  await assert.rejects(() => invalid('message', rules), /JEV_INVALID_RESPONSE/);
  const unavailable = createJev({ key: 'test', fetcher: async () => new Response('', { status: 429 }) });
  await assert.rejects(() => unavailable('message', rules), /JEV_HTTP_429/);
});
