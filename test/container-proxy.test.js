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
