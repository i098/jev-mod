import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Miniflare, Response as RuntimeResponse } from 'miniflare';

const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('wrangler'))('esbuild');

test('Worker provider requests succeed without following credential-bearing redirects', async t => {
  const bundle = await build({ bundle: true, write: false, format: 'esm', platform: 'neutral',
    mainFields: ['module', 'main'], conditions: ['workerd', 'worker', 'browser'], external: ['cloudflare:*', 'node:*'],
    stdin: { resolveDir: fileURLToPath(new URL('../packages/core', import.meta.url)), contents: `
      import { Effect } from 'effect';
      import { listDiscordGuilds } from '../../apps/server/src/app.ts';
      import { evaluateMessage } from './src/jev.ts';
      import { defaultSettings } from './src/policy.ts';
      export default { async fetch(request) {
        try {
          if (new URL(request.url).pathname === '/discord') return Response.json(await listDiscordGuilds('synthetic-key'));
          const result = await Effect.runPromise(Effect.either(evaluateMessage('sample', defaultSettings().rules.slice(0, 1), { key: 'synthetic-key' })));
          return Response.json(result);
        } catch (error) { return Response.json({ error: error.message }, { status: 503 }); }
      } };
    ` } });
  let status = 200;
  const requests = [];
  const runtime = new Miniflare({ modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: '2026-08-06', compatibilityFlags: ['nodejs_compat'],
    outboundService: request => {
      requests.push(new URL(request.url).hostname);
      assert.equal(request.headers.get('authorization'), 'Bearer synthetic-key');
      if (status !== 200) return new RuntimeResponse('', { status, headers: { Location: 'https://untrusted.invalid/' } });
      return RuntimeResponse.json(new URL(request.url).hostname === 'discord.com'
        ? [{ id: '100000000000000001', name: 'Sample server', permissions: '32' }]
        : { model: 'fixture', answers: { scams: { type: 'noul', noul: 0.95 } } });
    } });
  t.after(() => runtime.dispose());
  const guilds = await runtime.dispatchFetch('https://example.invalid/discord');
  assert.equal(guilds.status, 200, await guilds.clone().text());
  assert.equal((await guilds.json())[0].id, '100000000000000001');
  const decision = await (await runtime.dispatchFetch('https://example.invalid/jev')).json();
  assert.equal(decision._tag, 'Right');
  assert.equal(decision.right.matches.length, 1);
  for (status of [301, 302, 303, 307, 308]) {
    requests.length = 0;
    assert.equal((await runtime.dispatchFetch('https://example.invalid/discord')).status, 503);
    const rejected = await (await runtime.dispatchFetch('https://example.invalid/jev')).json();
    assert.equal(rejected._tag, 'Left');
    assert.equal(rejected.left.code, `JEV_HTTP_${status}`);
    assert.deepEqual(requests, ['discord.com', 'api.typesafe.ai']);
  }
});

test('exported ContainerProxy routes the private store bridge and rejects other containers', async t => {
  const bundle = await build({ bundle: true, write: false, format: 'esm', platform: 'neutral', keepNames: true,
    mainFields: ['module', 'main'], conditions: ['workerd', 'worker', 'browser'], external: ['cloudflare:*', 'node:*'],
    stdin: { resolveDir: fileURLToPath(new URL('..', import.meta.url)), contents: `
      export { BotContainer, ContainerProxy } from './apps/server/src/index.ts';
      export default { fetch(request, env, ctx) {
        const containerId = env.BOT.idFromName(request.headers.get('x-container') || 'gateway-v1').toString();
        return ctx.exports.ContainerProxy({ props: { className: 'BotContainer', containerId, enableInternet: false } }).fetch(request);
      } };
    ` } });
  const runtime = new Miniflare({ modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: '2026-08-06', compatibilityFlags: ['nodejs_compat'],
    durableObjects: { BOT: { className: 'BotContainer', useSQLite: true } }, d1Databases: { DB: 'proxy-test' } });
  t.after(() => runtime.dispose());
  const db = await runtime.getD1Database('DB');
  await db.prepare('CREATE TABLE guilds (id TEXT PRIMARY KEY NOT NULL, joined_at INTEGER NOT NULL)').run();
  const guildId = '100000000000000001';
  const request = { method: 'POST', body: JSON.stringify({ method: 'registerGuild', args: [guildId] }) };
  const denied = await runtime.dispatchFetch('http://jev.internal/store', { ...request, headers: { 'x-container': 'other' } });
  assert.equal(denied.status, 403);
  assert.equal(await db.prepare('SELECT id FROM guilds').first(), null);
  const allowed = await runtime.dispatchFetch('http://jev.internal/store', request);
  assert.equal(allowed.status, 200);
  assert.deepEqual(await db.prepare('SELECT id FROM guilds').first(), { id: guildId });
});

test('Worker health reports Gateway readiness and fails closed on dependency errors', async t => {
  const bundle = await build({ bundle: true, write: false, format: 'esm', platform: 'neutral',
    mainFields: ['module', 'main'], conditions: ['workerd', 'worker', 'browser'], external: ['cloudflare:*', 'node:*'],
    stdin: { resolveDir: fileURLToPath(new URL('..', import.meta.url)), contents: `
      import worker from './apps/server/src/index.ts';
      export default { fetch(request) {
        const mode = request.headers.get('x-bot-state');
        const BOT = { idFromName(name) { if(name !== 'gateway-v1') throw Error('Wrong instance'); return name; },
          get() { return { async fetch(input) {
            if (new URL(input.url).pathname !== '/healthz') throw Error('Wrong endpoint');
            if (mode === 'disabled' || mode === 'error') throw Error('Synthetic dependency failure');
            if (mode === 'bad-json') return new Response('Synthetic private provider details');
            if (mode === 'null-json') return Response.json(null);
            if (mode === 'string-connected') return Response.json({ connected: 'true' });
            if (mode === 'non-ok') return Response.json({ connected: true }, { status: 503 });
            return Response.json({ connected: mode === 'connected' });
          } }; } };
        return worker.fetch(request, { BOT, BOT_ENABLED: mode === 'disabled' ? 'false' : 'true', PUBLIC_URL: 'https://app.example.com' });
      } };
    ` } });
  const runtime = new Miniflare({ modules: [{ type: 'ESModule', path: 'health.mjs', contents: bundle.outputFiles[0].text }],
    compatibilityDate: '2026-08-06', compatibilityFlags: ['nodejs_compat'] });
  t.after(() => runtime.dispose());
  for (const [mode, status, bot] of [['disabled', 200, 'disabled'], ['connected', 200, 'connected'],
    ...['starting', 'error', 'bad-json', 'null-json', 'string-connected', 'non-ok'].map(mode => [mode, 503, 'unavailable'])]) {
    const response = await runtime.dispatchFetch('https://example.invalid/healthz', { headers: { 'x-bot-state': mode } });
    assert.equal(response.status, status);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { status: status === 200 ? 'ok' : 'not_ready', bot });
  }
  for (const method of ['GET', 'POST']) {
    const response = await runtime.dispatchFetch('https://old.workers.dev/api/auth/callback/discord?code=synthetic&state=synthetic', { method, redirect: 'manual' });
    assert.equal(response.status, 307);
    assert.equal(response.headers.get('location'), 'https://app.example.com/api/auth/callback/discord?code=synthetic&state=synthetic');
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
});
