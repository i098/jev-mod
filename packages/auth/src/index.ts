import { betterAuth } from 'better-auth';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import type { Database } from '@jev-mod/db/index.ts';
import * as schema from '@jev-mod/db/schema/index.ts';

export type AuthEnv = { PUBLIC_URL: string; BETTER_AUTH_SECRET: string;
  DISCORD_CLIENT_ID: string; DISCORD_CLIENT_SECRET: string };
export function createAuth(env: AuthEnv, db: Database) {
  return betterAuth({
    appName: 'Jev-Mod', baseURL: env.PUBLIC_URL, secret: env.BETTER_AUTH_SECRET,
    logger: { level: 'error', log: () => console.error(JSON.stringify({ event: 'auth_failed' })) },
    database: drizzleAdapter(db, { provider: 'sqlite', schema, transaction: false }),
    trustedOrigins: [env.PUBLIC_URL],
    session: { expiresIn: 3600, cookieCache: { enabled: false } },
    account: { encryptOAuthTokens: true, storeStateStrategy: 'database', accountLinking: { enabled: false } },
    socialProviders: { discord: {
      clientId: env.DISCORD_CLIENT_ID, clientSecret: env.DISCORD_CLIENT_SECRET,
      scope: ['identify', 'guilds'],
      mapProfileToUser: profile => ({ email: profile.email ?? `${profile.id}@discord.invalid`, emailVerified: profile.verified ?? false }),
    } },
    advanced: { useSecureCookies: env.PUBLIC_URL.startsWith('https:'),
      defaultCookieAttributes: { sameSite: 'lax', httpOnly: true } },
  });
}
