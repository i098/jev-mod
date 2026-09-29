import { z } from 'zod';

export function readConfig(env = process.env) {
  const schema = z.object({
    NODE_ENV: z.enum(['development', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(7102),
    HOST: z.string().default('127.0.0.1'),
    PUBLIC_URL: z.url(),
    TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
    DISCORD_CLIENT_ID: z.string().regex(/^\d{17,20}$/),
    DISCORD_CLIENT_SECRET: z.string().min(20),
    DISCORD_BOT_TOKEN: z.string().min(30),
    TYPESAFE_API_KEY: z.string().min(10),
    SESSION_SECRET: z.string().min(32),
    DATABASE_URL: z.string().startsWith('mysql://'),
    DATABASE_TLS: z.enum(['true', 'false']).default('false'),
    JEV_MODEL: z.string().min(1).max(100).default('jev-1.13.0'),
    JEV_REQUESTS_PER_MINUTE: z.coerce.number().int().min(1).max(1000).default(60),
    JEV_GLOBAL_REQUESTS_PER_MINUTE: z.coerce.number().int().min(1).max(1000).default(600),
  });
  const parsed = schema.safeParse(env);
  if (!parsed.success) throw new Error(`Missing or invalid configuration: ${parsed.error.issues.map(issue => issue.path.join('.')).join(', ')}`);
  const config = parsed.data;
  const url = new URL(config.PUBLIC_URL);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('PUBLIC_URL must be an origin without a path, query, or credentials.');
  if (config.NODE_ENV === 'production' && url.protocol !== 'https:') throw new Error('Production PUBLIC_URL requires HTTPS.');
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('PUBLIC_URL must use HTTP or HTTPS.');
  config.PUBLIC_URL = url.origin;
  return config;
}
