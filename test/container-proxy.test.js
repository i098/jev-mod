import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';

const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('wrangler'))('esbuild');

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
            return Response.json({ connected: mode === 'connected' });
          } }; } };
        return worker.fetch(request, { BOT, BOT_ENABLED: mode === 'disabled' ? 'false' : 'true' });
      } };
    ` } });
  const runtime = new Miniflare({ modules: [{ type: 'ESModule', path: 'health.mjs', contents: bundle.outputFiles[0].text }],
    compatibilityDate: '2026-08-06', compatibilityFlags: ['nodejs_compat'] });
  t.after(() => runtime.dispose());
  for (const [mode, status, bot] of [['disabled', 200, 'disabled'], ['connected', 200, 'connected'], ['starting', 503, 'unavailable'], ['error', 503, 'unavailable']]) {
    const response = await runtime.dispatchFetch('https://example.invalid/healthz', { headers: { 'x-bot-state': mode } });
    assert.equal(response.status, status);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { status: status === 200 ? 'ok' : 'not_ready', bot });
  }
});
