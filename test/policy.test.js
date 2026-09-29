import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { defaultSettings, settingsSchema, isExempt, localMatches, canManage } from '../packages/core/src/policy.ts';
import { evaluateMessage, JevFailure } from '../packages/core/src/jev.ts';

const { Effect } = createRequire(new URL('../packages/core/package.json', import.meta.url))('effect');

test('policy validates bounds and requires one of every rule', () => {
  const settings = defaultSettings();
  assert.ok(settings.rules.every(rule => rule.threshold === 0.65), 'Every new rule defaults to 65%');
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
  const config = { key: 'test', fetcher: async (url, options) => {
    assert.equal(url, 'https://api.typesafe.ai/v1/systemone');
    payload = JSON.parse(options.body);
    return Response.json({ model: 'jev-1.13.0', answers: { scams: { type: 'noul', noul: 0.95 } } });
  } };
  assert.equal((await Effect.runPromise(evaluateMessage('test content', rules, config))).matches.length, 1);
  assert.deepEqual(payload.state, { message: 'test content' });
  assert.equal(payload.model, 'jev-1.13.0');
  for (const [fetcher, code] of [
    [async () => Response.json({ model: 'test', answers: { scams: { type: 'noul', noul: '0.99' } } }), 'JEV_INVALID_RESPONSE'],
    [async () => Response.json({ model: 'test', answers: {} }), 'JEV_INVALID_RESPONSE'],
    [async () => new Response('not JSON'), 'JEV_INVALID_RESPONSE'],
    [async () => new Response('', { status: 429 }), 'JEV_HTTP_429'],
    [async () => { throw new Error('unavailable'); }, 'JEV_CONNECTION_FAILED'],
  ]) {
    const result = await Effect.runPromise(Effect.either(evaluateMessage('message', rules, { key: 'test', fetcher })));
    assert.equal(result._tag, 'Left');
    assert.ok(result.left instanceof JevFailure);
    assert.equal(result.left.code, code);
  }
});

test('disabled Jev rules need no key or model request', async () => {
  let requests = 0;
  const config = { key: '', fetcher: async () => { requests++; throw new Error('unexpected request'); } };
  const rules = defaultSettings().rules.map(rule => ({ ...rule, enabled: false }));
  assert.deepEqual(await Effect.runPromise(evaluateMessage('message', rules, config)), { model: null, matches: [], scores: [] });
  const result = await Effect.runPromise(Effect.either(evaluateMessage('message', defaultSettings().rules, config)));
  assert.equal(result._tag, 'Left');
  assert.equal(result.left.code, 'JEV_KEY_MISSING');
  assert.equal(requests, 0);
});

test('Jev timeout aborts the original request while response JSON is stalled', { timeout: 15000 }, async () => {
  let requestSignal;
  let bodyStarted = false;
  let bodyAborted = false;
  const fetcher = async (_url, { signal }) => {
    requestSignal = signal;
    return { ok: true, json: () => new Promise((_resolve, reject) => {
      bodyStarted = true;
      signal.addEventListener('abort', () => { bodyAborted = true; reject(signal.reason); }, { once: true });
    }) };
  };
  const result = await Effect.runPromise(Effect.either(evaluateMessage('message', defaultSettings().rules, { key: 'test', fetcher })));
  assert.equal(result._tag, 'Left');
  assert.ok(result.left instanceof JevFailure);
  assert.equal(result.left.code, 'JEV_TIMEOUT');
  assert.equal(bodyStarted, true);
  assert.equal(requestSignal.aborted, true);
  assert.equal(bodyAborted, true);
});
