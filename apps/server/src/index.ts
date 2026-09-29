import { Container, getContainer } from '@cloudflare/containers';
import { createDb, createStore } from '@jev-mod/db/index.ts';
import { createDashboard, type BotApi } from './app.ts';
import { storeBridge } from './bridge.ts';
import { createClassifier, createServices, type RuntimeEnv } from './services.ts';

export { ContainerProxy } from '@cloudflare/containers';

export interface Env extends RuntimeEnv {
  DB: D1Database;
  ASSETS: Fetcher;
  BOT: DurableObjectNamespace<BotContainer>;
  DISCORD_BOT_TOKEN: string;
  BOT_ENABLED: string;
}
export class BotContainer extends Container<Env> {
  defaultPort = 8080;
  sleepAfter = '10m';
  envVars = { DISCORD_BOT_TOKEN: this.env.DISCORD_BOT_TOKEN,
    PUBLIC_URL: this.env.PUBLIC_URL, STORE_URL: 'http://jev.internal/store' };
  override async onActivityExpired() {
    if (this.env.BOT_ENABLED === 'true') this.renewActivityTimeout();
    else await this.stop();
  }
}
BotContainer.outboundByHost = {
  'jev.internal': async (request, environment, context) => {
    const env = environment as Env;
    if (context.containerId !== env.BOT.idFromName('gateway-v1').toString()) return new Response('Forbidden', { status: 403 });
    const store = createStore(createDb(env.DB));
    return storeBridge(request, store, createClassifier(store, env));
  },
};

function botApi(env: Env): BotApi {
  async function call<T>(method: string, args: unknown[]): Promise<T> {
    if (env.BOT_ENABLED !== 'true') throw Object.assign(new Error('The Discord bot is not enabled yet.'), { status: 503 });
    const response = await getContainer(env.BOT, 'gateway-v1').fetch(new Request('http://bot/rpc', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method, args }),
    }));
    if (!response.ok) throw Object.assign(new Error('Discord is unavailable or access was denied.'), { status: response.status });
    const data = await response.json() as { result: T };
    return data.result;
  }
  return {
    authorize: (guild, user) => call('authorize', [guild, user]),
    metadata: guild => call('metadata', [guild]),
    validateSettings: (guild, settings) => call('validateSettings', [guild, settings]),
    enforce: input => call('enforce', [input]),
    health: () => call('health', []),
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === '/healthz') return Response.json({ status: 'ok' });
    if (!path.startsWith('/api/')) return env.ASSETS.fetch(request);
    const store = createStore(createDb(env.DB));
    const app = createDashboard(createServices(env, store, botApi(env), request => request.headers.get('cf-connecting-ip') ?? 'unknown'));
    return app.fetch(request);
  },
  async scheduled(controller: ScheduledController, env: Env, context: ExecutionContext) {
    if (new Date(controller.scheduledTime).getUTCMinutes() === 0) context.waitUntil(createStore(createDb(env.DB)).cleanup());
    if (env.BOT_ENABLED === 'true') {
      context.waitUntil(getContainer(env.BOT, 'gateway-v1').fetch(new Request('http://bot/healthz'))
        .then(async response => {
          const health = await response.json() as { connected?: boolean };
          if (!response.ok || !health.connected) console.error(JSON.stringify({ event: 'bot_not_ready' }));
        }).catch(() => console.error(JSON.stringify({ event: 'bot_start_failed' }))));
    }
  },
};
