import { createStore } from '@jev-mod/db/index.ts';
import { createDashboard, type BotApi } from './app.ts';

const guilds = [{ id: '100000000000000001', name: 'The Commons', installed: true },
  { id: '100000000000000002', name: 'Developer Lounge', installed: true }];
const previewBot: BotApi = {
  async authorize(guild) { if (!guilds.some(item => item.id === guild)) throw Object.assign(new Error('Access denied.'), { status: 403 }); },
  async metadata(id) { return { ...guilds.find(item => item.id === id)!,
    channels: [{ id: '200000000000000001', name: 'general', sendable: true }, { id: '200000000000000002', name: 'mod-log', sendable: true }, { id: '200000000000000003', name: 'off-topic', sendable: true }],
    roles: [{ id: '300000000000000001', name: 'Moderators' }, { id: '300000000000000002', name: 'Members' }],
    permissions: { manageMessages: true, moderateMembers: true } }; },
  async validateSettings() {},
  async enforce() { throw new Error('Preview never performs Discord actions.'); },
  async health() { return { connected: false }; },
};
async function seed(store: ReturnType<typeof createStore>) {
  for (const guild of guilds) await store.registerGuild(guild.id);
  const messages = [
    ['scams', 'Scams & phishing', 'Claim your free Nitro! Enter your password at this giveaway link.'],
    ['spam', 'Spam & promotion', 'Buy followers now! Best prices, instant delivery. Message me for deals.'],
    ['harassment', 'Harassment', 'You are worthless. Leave this server. Nobody wants you here.'],
  ];
  for (const [i, [id, name, content]] of messages.entries()) {
    await store.addCase({ guildId: guilds[0].id, channelId: '200000000000000001', messageId: `40000000000000000${i}`,
      authorId: `50000000000000000${i}`, messageHash: String(i).repeat(64), policyVersion: 0, content,
      matches: [{ id, name, probability: [0.98, 0.96, 0.93][i], action: 'delete' }],
      model: 'Sample data — not Jev results', requestedAction: 'delete', outcome: 'monitored' });
  }
}
export default {
  async fetch(request: Request, env: { DB: D1Database; PUBLIC_URL: string }) {
    if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(request.url).hostname)) return new Response('Preview only runs on loopback.', { status: 403 });
    const store = createStore(env.DB);
    if (!(await store.allGuilds()).length) await seed(store);
    return createDashboard({ store, bot: previewBot, origin: env.PUBLIC_URL, clientId: '', demo: true,
      user: async () => ({ id: 'preview', discordId: '600000000000000001', name: 'Demo moderator' }),
      guilds: async () => guilds,
      auth: async () => Response.json({ error: 'Preview has no Discord login.' }, { status: 409 }),
      classify: async () => { throw Object.assign(new Error('Connect Jev in the configured app to test messages. Preview uses sample cases only.'), { status: 409 }); },
    }).fetch(request);
  },
};
