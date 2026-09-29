import { Effect } from 'effect';
import { and, eq } from 'drizzle-orm';
import { createAuth, type AuthEnv } from '@jev-mod/auth';
import { account } from '@jev-mod/db/schema/index.ts';
import type { Store } from '@jev-mod/db/index.ts';
import { evaluateMessage } from '@jev-mod/core/jev.ts';
import type { Decision } from '@jev-mod/core/types.ts';
import { listDiscordGuilds, type BotApi, type Services } from './app.ts';
import { encryptKey, getKeyStatus, selectKey, type KeyEnv } from './keys.ts';

export type RuntimeEnv = AuthEnv & KeyEnv;
export function createClassifier(store: Store, env: KeyEnv) {
  return async (guildId: string, content: string, expectedVersion?: number): Promise<Decision> => {
    const policy = await store.getSettings(guildId);
    if (expectedVersion !== undefined && policy.version !== expectedVersion) {
      throw Object.assign(new Error('Settings changed. Try again.'), { status: 409 });
    }
    if (!policy.settings.rules.some(rule => rule.enabled)) return { model: null, matches: [], scores: [] };
    const key = await selectKey(store, guildId, env);
    if (!await store.consumeBudget(`jev:guild:${guildId}`, 60) || !await store.consumeBudget('jev:global', 600)) {
      throw Object.assign(new Error('Message evaluation limit reached. Try again in a minute.'), { status: 429 });
    }
    const decision = await Effect.runPromise(evaluateMessage(content, policy.settings.rules, { key }));
    if ((await store.getSettings(guildId)).version !== policy.version) throw Object.assign(new Error('Settings changed. Try again.'), { status: 409 });
    return decision;
  };
}
export function createServices(env: RuntimeEnv, store: Store, bot: BotApi, clientAddress: (request: Request) => string): Services {
  const auth = createAuth(env, store.db);
  return {
    store, bot, clientAddress, origin: env.PUBLIC_URL, clientId: env.DISCORD_CLIENT_ID, demo: false,
    auth: request => auth.handler(request),
    user: async request => {
      const session = await auth.api.getSession({ headers: request.headers });
      if (!session) return null;
      const [provider] = await store.db.select().from(account)
        .where(and(eq(account.userId, session.user.id), eq(account.providerId, 'discord')));
      return provider ? { id: session.user.id, name: session.user.name, discordId: provider.accountId } : null;
    },
    classify: createClassifier(store, env),
    keyStatus: guildId => getKeyStatus(store, guildId, env),
    saveKey: async (guildId, value, actorId) => {
      await store.saveTypeSafeKey(guildId, await encryptKey(guildId, value, env.KEY_ENCRYPTION_SECRET), actorId);
      return getKeyStatus(store, guildId, env);
    },
    removeKey: async (guildId, actorId) => { await store.removeTypeSafeKey(guildId, actorId); return getKeyStatus(store, guildId, env); },
    guilds: async (user, request) => {
      const [provider] = await store.db.select().from(account)
        .where(and(eq(account.userId, user.id), eq(account.providerId, 'discord')));
      if (!provider) throw Object.assign(new Error('Sign in again.'), { status: 401 });
      const token = await auth.api.getAccessToken({ headers: request.headers, body: { accountId: provider.id } });
      const [list, installed] = await Promise.all([listDiscordGuilds(token.accessToken), store.allGuilds()]);
      const ids = new Set(installed.map(guild => guild.id));
      return list.map(guild => ({ id: guild.id, name: guild.name, installed: ids.has(guild.id) }));
    },
  };
}
