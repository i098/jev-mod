import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { serve, type HttpBindings } from '@hono/node-server';
import { getConnInfo } from '@hono/node-server/conninfo';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { bearerAuth } from 'hono/bearer-auth';
import { bodyLimit } from 'hono/body-limit';
import { secureHeaders } from 'hono/secure-headers';
import { z } from 'zod';
import { createStore, type Store } from '@jev-mod/db/index.ts';
import { openDatabase } from '@jev-mod/db/node.ts';
import { createDashboard, type BotApi } from './app.ts';
import { storeBridge } from './bridge.ts';
import { createClassifier, createServices } from './services.ts';

const optionalSecret = (schema: z.ZodString) => z.preprocess(value => value === '' ? undefined : value, schema.optional());
const configSchema = z.object({
  PUBLIC_URL: z.url().refine(value => {
    const url = new URL(value);
    return url.origin === value && !url.username && !url.password
      && (url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  }, 'Use an HTTPS origin, or HTTP on localhost.'),
  BETTER_AUTH_SECRET: z.string().min(32), DISCORD_CLIENT_ID: z.string().regex(/^\d{17,20}$/),
  DISCORD_CLIENT_SECRET: z.string().min(1), INTERNAL_RPC_SECRET: z.string().regex(/^[A-Za-z0-9_-]{32,}$/),
  KEY_ENCRYPTION_SECRET: optionalSecret(z.string().regex(/^[a-f\d]{64}$/i)),
  TYPESAFE_API_KEY: optionalSecret(z.string().min(1)),
  DATABASE_PATH: z.string().min(1).default('data/jev-mod.sqlite'),
  BOT_RPC_URL: z.url().default('http://bot:8080/rpc'), BOT_ENABLED: z.enum(['true', 'false']).default('false'),
  PORT: z.coerce.number().int().min(0).max(65535).default(7102),
});
type NodeEnv = z.infer<typeof configSchema>;

export function createBotApi(env: Pick<NodeEnv, 'BOT_ENABLED' | 'BOT_RPC_URL' | 'INTERNAL_RPC_SECRET'>): BotApi {
  async function call<T>(method: string, args: unknown[]): Promise<T> {
    if (env.BOT_ENABLED !== 'true') throw Object.assign(new Error('The Discord bot is not enabled yet.'), { status: 503 });
    const response = await fetch(env.BOT_RPC_URL, { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.INTERNAL_RPC_SECRET}` },
      body: JSON.stringify({ method, args }), signal: AbortSignal.timeout(15000), redirect: 'error' });
    if (!response.ok) throw Object.assign(new Error('Discord is unavailable or access was denied.'), { status: response.status });
    return ((await response.json()) as { result: T }).result;
  }
  return {
    authorize: (guild, user) => call('authorize', [guild, user]), metadata: guild => call('metadata', [guild]),
    validateSettings: (guild, settings) => call('validateSettings', [guild, settings]),
    enforce: input => call('enforce', [input]), health: () => call('health', []),
  };
}

export function createNodeApp(env: NodeEnv, store: Store) {
  const app = new Hono<{ Bindings: HttpBindings }>();
  const bot = createBotApi(env);
  const classify = createClassifier(store, env);
  app.use('*', secureHeaders({ referrerPolicy: 'no-referrer' }));
  app.get('/healthz', c => c.json({ status: 'ok' }));
  app.use('/internal/*', bearerAuth({ token: env.INTERNAL_RPC_SECRET }));
  app.use('/internal/*', bodyLimit({ maxSize: 65536, onError: c => c.json({ error: 'Request too large.' }, 413) }));
  app.post('/internal/store', c => {
    const url = new URL(c.req.url); url.pathname = '/store';
    return storeBridge(new Request(url, c.req.raw), store, classify);
  });
  app.all('/internal/*', c => c.json({ error: 'Not found.' }, 404));
  app.all('/api/*', c => {
    const address = getConnInfo(c).remote.address ?? 'unknown';
    const headers = new Headers(c.req.raw.headers);
    headers.delete('forwarded');
    for (const name of ['x-forwarded-for', 'x-real-ip', 'cf-connecting-ip', 'true-client-ip']) headers.set(name, address);
    const request = new Request(c.req.raw, { headers });
    return createDashboard(createServices(env, store, bot, () => address)).fetch(request);
  });
  const root = fileURLToPath(new URL('../../web/dist/', import.meta.url));
  app.get('*', serveStatic({ root }));
  app.get('*', serveStatic({ path: `${root}/index.html` }));
  app.onError((error, c) => {
    if (error instanceof HTTPException) return error.getResponse();
    console.error(JSON.stringify({ event: 'request_failed', status: 503 }));
    return c.json({ error: 'Service unavailable.' }, 503);
  });
  return app;
}

export async function startNodeServer(environment: Record<string, string | undefined> = process.env) {
  const env = configSchema.parse(environment);
  const database = openDatabase(env.DATABASE_PATH);
  const store = createStore(database.db);
  try {
    await store.cleanup();
    const app = createNodeApp(env, store);
    const server = serve({ fetch: app.fetch, hostname: '0.0.0.0', port: env.PORT });
    await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
    const cleanup = setInterval(() => {
      void store.cleanup().catch(() => console.error(JSON.stringify({ event: 'cleanup_failed' })));
    }, 3600000).unref();
    let closing: Promise<void> | undefined;
    return { server, close: () => closing ??= new Promise<void>((resolve, reject) => {
      clearInterval(cleanup);
      server.close(error => { database.close(); if (error) reject(error); else resolve(); });
    }) };
  } catch (error) {
    database.close();
    throw error;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const runtime = await startNodeServer();
    let stopping = false;
    const stop = async () => {
      if (stopping) return;
      stopping = true;
      const deadline = setTimeout(() => process.exit(1), 15000).unref();
      try { await runtime.close(); } finally { clearTimeout(deadline); }
    };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
  } catch {
    console.error(JSON.stringify({ event: 'server_start_failed', hint: 'Check configuration, migrations, and database permissions.' }));
    process.exitCode = 1;
  }
}
