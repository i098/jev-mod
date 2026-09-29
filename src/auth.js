import { randomBytes, timingSafeEqual } from 'node:crypto';
import { canManage } from './policy.js';

const nonce = () => randomBytes(32).toString('hex');
export const constantEqual = (a, b) => typeof a === 'string' && typeof b === 'string'
  && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const save = request => new Promise((resolve, reject) => request.session.save(error => error ? reject(error) : resolve()));
const regenerate = request => new Promise((resolve, reject) => request.session.regenerate(error => error ? reject(error) : resolve()));

export function installAuth(app, config, { fetcher = fetch, demo = false, stateStore } = {}) {
  const callback = `${config.PUBLIC_URL}/auth/callback`;
  async function discordRequest(path, options = {}) {
    const response = await fetcher(`https://discord.com/api/v10${path}`, {
      ...options, signal: AbortSignal.timeout(10000), redirect: 'error',
    });
    if (!response.ok) throw Object.assign(new Error('Discord request failed. Sign in again or try shortly.'), { status: response.status === 401 ? 401 : 503 });
    return response.json();
  }
  app.get('/auth/login', async (request, response) => {
    if (demo) return response.redirect('/');
    request.session.oauthState = nonce();
    request.session.oauthStartedAt = Date.now();
    await save(request);
    await stateStore.createOAuthState(request.sessionID, request.session.oauthState, Date.now() + 600000);
    const params = new URLSearchParams({ client_id: config.DISCORD_CLIENT_ID, response_type: 'code',
      scope: 'identify guilds', redirect_uri: callback, state: request.session.oauthState });
    response.redirect(`https://discord.com/oauth2/authorize?${params}`);
  });
  app.get('/auth/callback', async (request, response) => {
    if (demo) return response.status(404).end();
    const expected = request.session.oauthState;
    const started = request.session.oauthStartedAt;
    delete request.session.oauthState;
    delete request.session.oauthStartedAt;
    await save(request);
    if (!constantEqual(request.query.state, expected) || !started || Date.now() - started > 600000
      || typeof request.query.code !== 'string' || request.query.code.length > 200
      || !await stateStore.consumeOAuthState(request.sessionID, request.query.state)) {
      return response.status(400).send('Sign-in expired or was not valid. Start again from the dashboard.');
    }
    const token = await discordRequest('/oauth2/token', { method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: config.DISCORD_CLIENT_ID, client_secret: config.DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code', code: request.query.code, redirect_uri: callback }),
    });
    if (typeof token.access_token !== 'string' || !Number.isFinite(token.expires_in)) throw new Error('DISCORD_INVALID_TOKEN');
    const user = await discordRequest('/users/@me', { headers: { Authorization: `Bearer ${token.access_token}` } });
    if (typeof user.id !== 'string' || typeof user.username !== 'string') throw new Error('DISCORD_INVALID_USER');
    await regenerate(request);
    request.session.user = { id: user.id, username: user.username, name: user.global_name ?? user.username };
    request.session.accessToken = token.access_token;
    request.session.tokenExpires = Date.now() + Math.min(token.expires_in * 1000, 3600000);
    request.session.csrf = nonce();
    await save(request);
    response.redirect('/');
  });
  return {
    nonce,
    async guilds(request) {
      const guilds = [];
      let after = '0';
      for (let page = 0; page < 5; page++) {
        const batch = await discordRequest(`/users/@me/guilds?limit=200&after=${after}`, { headers: { Authorization: `Bearer ${request.session.accessToken}` } });
        if (!Array.isArray(batch)) throw new Error('DISCORD_INVALID_GUILDS');
        guilds.push(...batch.filter(canManage).map(guild => ({ id: guild.id, name: guild.name })));
        if (batch.length < 200) break;
        after = batch.reduce((max, guild) => BigInt(guild.id) > BigInt(max) ? guild.id : max, after);
      }
      return guilds;
    },
  };
}
