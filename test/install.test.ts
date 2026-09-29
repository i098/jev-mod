import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../packages/db/src/node.ts';
import { createStore } from '../packages/db/src/index.ts';
import { createDashboard, type BotApi } from '../apps/server/src/app.ts';
import { createServices } from '../apps/server/src/services.ts';

test('installation uses Better Auth state and returns to a fixed dashboard callback', async t => {
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = async () => { providerCalls++; throw Error('Unexpected provider request'); };
  t.after(() => { globalThis.fetch = originalFetch; });
  const database = openDatabase(':memory:');
  t.after(database.close);
  const env = { PUBLIC_URL: 'https://dashboard.example.com', BETTER_AUTH_SECRET: 'synthetic-auth-secret-for-install-tests',
    DISCORD_CLIENT_ID: '100000000000000001', DISCORD_CLIENT_SECRET: 'synthetic-discord-secret', KEY_ENCRYPTION_SECRET: 'a'.repeat(64) };
  const unexpected = async (): Promise<never> => { throw Error('Installation initiation must not call the bot'); };
  const bot: BotApi = { authorize: unexpected, metadata: unexpected, validateSettings: unexpected, enforce: unexpected, health: unexpected };
  const services = createServices(env, createStore(database.db), bot, () => 'test');
  let authResponse: Response;
  const app = createDashboard({ ...services, auth: async request => {
    const response = await services.auth(request);
    authResponse = response.clone();
    return response;
  } });
  const request = async (path: string, init?: RequestInit) => {
    const response = await app.request(env.PUBLIC_URL + path, init);
    if (path.startsWith('/api/auth/')) {
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.status, authResponse.status);
      assert.equal(response.statusText, authResponse.statusText);
      assert.deepEqual(response.headers.getSetCookie(), authResponse.headers.getSetCookie());
      assert.equal(await response.clone().text(), await authResponse.text());
    }
    return response;
  };
  const guild = '200000000000000001';
  const response = await request(`/api/install?guild_id=${guild}`);
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const authorization = new URL(response.headers.get('location')!);
  assert.equal(authorization.origin, 'https://discord.com');
  assert.equal(authorization.searchParams.get('response_type'), 'code');
  assert.equal(authorization.searchParams.get('redirect_uri'), env.PUBLIC_URL + '/api/auth/callback/discord');
  for (const scope of ['bot', 'applications.commands', 'identify', 'guilds']) assert.ok(authorization.searchParams.get('scope')!.split(' ').includes(scope));
  assert.equal(authorization.searchParams.get('permissions'), '1099511704576');
  assert.equal(authorization.searchParams.get('guild_id'), guild);
  assert.equal(authorization.searchParams.get('disable_guild_select'), 'true');
  assert.equal(authorization.searchParams.get('integration_type'), '0');
  assert.equal(authorization.searchParams.get('prompt'), 'consent');
  assert.ok(authorization.searchParams.get('state'));
  const cookies = response.headers.getSetCookie();
  assert.ok(cookies.some(cookie => cookie.includes('HttpOnly') && cookie.includes('Secure')));
  const cookie = cookies.map(value => value.split(';')[0]).join('; ');
  const state = authorization.searchParams.get('state')!;
  const cancelled = await request(`/api/auth/callback/discord?error=access_denied&state=${encodeURIComponent(state)}`, { headers: { cookie } });
  assert.equal(cancelled.status, 302);
  assert.equal(new URL(cancelled.headers.get('location')!).origin, env.PUBLIC_URL);
  assert.equal(new URL(cancelled.headers.get('location')!).searchParams.get('installation'), 'cancelled');
  const forged = await request('/api/auth/callback/discord?code=synthetic&state=forged');
  assert.equal(forged.status, 302);
  assert.notEqual(forged.headers.get('location'), `${env.PUBLIC_URL}/servers/${guild}/rules?installed=1`);
  for (const path of ['/api/install?guild_id=invalid', '/api/install?callbackURL=https://untrusted.invalid', '/api/install?permissions=8']) {
    assert.equal((await request(path)).status, 400);
  }
  const generic = new URL((await request('/api/install')).headers.get('location')!);
  assert.equal(generic.searchParams.has('guild_id'), false);
  assert.notEqual(generic.searchParams.get('state'), state);
  const login = await request('/api/auth/sign-in/social', { method: 'POST', headers: { Origin: env.PUBLIC_URL, 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'discord', callbackURL: env.PUBLIC_URL, disableRedirect: true }) });
  const normal = new URL((await login.json() as { url: string }).url);
  assert.equal(normal.searchParams.get('scope')!.split(' ').includes('bot'), false);
  assert.equal((await createDashboard({ ...services, demo: true }).request(env.PUBLIC_URL + '/api/install')).status, 409);
  assert.equal(providerCalls, 0);
  globalThis.fetch = async input => {
    providerCalls++;
    const url = new URL(input instanceof Request ? input.url : String(input));
    assert.equal(url.origin, 'https://discord.com');
    if (url.pathname === '/api/oauth2/token') return Response.json({ access_token: 'synthetic-access', token_type: 'Bearer', expires_in: 3600,
      scope: 'identify email guilds bot applications.commands' });
    assert.equal(decodeURIComponent(url.pathname), '/api/users/@me');
    return Response.json({ id: '300000000000000001', username: 'Synthetic moderator', discriminator: '0', avatar: null,
      email: 'moderator@example.invalid', verified: true });
  };
  const install = await request(`/api/install?guild_id=${guild}`);
  const installState = new URL(install.headers.get('location')!).searchParams.get('state')!;
  const installCookie = install.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  const callback = `/api/auth/callback/discord?code=synthetic-code&state=${encodeURIComponent(installState)}`;
  const completed = await request(callback, { headers: { cookie: installCookie } });
  assert.equal(completed.status, 302);
  assert.equal(completed.headers.get('location'), `${env.PUBLIC_URL}/servers/${guild}/rules?installed=1`);
  assert.ok(completed.headers.getSetCookie().some(value => value.includes('session_token=')));
  const sessionCookie = completed.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  const session = await request('/api/auth/get-session', { headers: { cookie: sessionCookie } });
  assert.equal((await session.json() as { user: { name: string } }).user.name, 'Synthetic moderator');
  assert.equal(providerCalls, 2);
  const replay = await request(callback, { headers: { cookie: installCookie } });
  assert.notEqual(replay.headers.get('location'), completed.headers.get('location'));
  assert.equal(providerCalls, 2);
});
