import { Container, getContainer } from '@cloudflare/containers';
import { Effect } from 'effect';
import { createAuth, type AuthEnv } from '@jev-mod/auth';
import { createStore } from '@jev-mod/db/index.ts';
import { account } from '@jev-mod/db/schema/index.ts';
import { eq, and } from 'drizzle-orm';
import { evaluateMessage } from '@jev-mod/core/jev.ts';
import { createDashboard, listDiscordGuilds, type BotApi, type User } from './app.ts';
import { storeBridge } from './bridge.ts';

export interface Env extends AuthEnv {
  ASSETS: Fetcher;
  BOT: DurableObjectNamespace<BotContainer>;
  DISCORD_BOT_TOKEN: string;
  TYPESAFE_API_KEY: string;
  BOT_ENABLED: string;
}
export class BotContainer extends Container<Env> {
  defaultPort = 8080;
  sleepAfter = '10m';
  envVars = { DISCORD_BOT_TOKEN: this.env.DISCORD_BOT_TOKEN, TYPESAFE_API_KEY: this.env.TYPESAFE_API_KEY,
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
    return storeBridge(request, env.DB);
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
    const auth = createAuth(env);
    const store = createStore(env.DB);
    let identity: Promise<User | null> | undefined;
    const app = createDashboard({ store, bot: botApi(env), origin: env.PUBLIC_URL, clientId: env.DISCORD_CLIENT_ID, demo: false,
      auth: request => auth.handler(request),
      user: () => identity ??= (async () => {
        const session = await auth.api.getSession({ headers: request.headers });
        if (!session) return null;
        const [provider] = await store.db.select({ discordId: account.accountId }).from(account)
          .where(and(eq(account.userId, session.user.id), eq(account.providerId, 'discord')));
        return provider ? { id: session.user.id, name: session.user.name, discordId: provider.discordId } : null;
      })(),
      classify: (text, rules) => Effect.runPromise(evaluateMessage(text, rules, { key: env.TYPESAFE_API_KEY })),
      guilds: async user => {
        const [provider] = await store.db.select({ id: account.id }).from(account).where(and(eq(account.userId, user.id), eq(account.providerId, 'discord')));
        if (!provider) throw Object.assign(new Error('Sign in again.'), { status: 401 });
        const token = await auth.api.getAccessToken({ headers: request.headers, body: { accountId: provider.id } });
        const [list, installed] = await Promise.all([listDiscordGuilds(token.accessToken), store.allGuilds()]);
        const ids = new Set(installed.map(guild => guild.id));
        return list.map(guild => ({ id: guild.id, name: guild.name, installed: ids.has(guild.id) }));
      },
    });
    return app.fetch(request);
  },
  async scheduled(controller: ScheduledController, env: Env, context: ExecutionContext) {
    if (new Date(controller.scheduledTime).getUTCMinutes() === 0) context.waitUntil(createStore(env.DB).cleanup());
    if (env.BOT_ENABLED === 'true') {
      context.waitUntil(getContainer(env.BOT, 'gateway-v1').fetch(new Request('http://bot/healthz'))
        .then(async response => {
          const health = await response.json() as { connected?: boolean };
          if (!response.ok || !health.connected) console.error(JSON.stringify({ event: 'bot_not_ready' }));
        }).catch(() => console.error(JSON.stringify({ event: 'bot_start_failed' }))));
    }
  },
};
