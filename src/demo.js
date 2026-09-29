import { randomBytes } from 'node:crypto';
import { createApp } from './app.js';
import { memoryStore, demoDiscord, demoGuilds } from './demo-data.js';
import { messageHash } from './moderation.js';

if (process.env.NODE_ENV === 'production') throw new Error('Demo cannot run in production.');
const store = memoryStore();
const samples = [
  ['scams', 'Scams & phishing', 'Claim your free Nitro! Enter your password at this giveaway link.', 0.98],
  ['spam', 'Spam & promotion', 'Buy followers now! Best prices, instant delivery. Message me for deals.', 0.96],
  ['harassment', 'Harassment', 'You are worthless. Leave this server. Nobody wants you here.', 0.93],
];
for (const [index, [rule, name, content, probability]] of samples.entries()) {
  await store.addCase({ guildId: demoGuilds[0].id, channelId: '200000000000000001', messageId: `40000000000000000${index}`,
    authorId: `50000000000000000${index}`, messageHash: messageHash(content), policyVersion: 0, content,
    matches: [{ id: rule, name, probability, action: 'delete' }], model: 'sample — not evaluated',
    requestedAction: 'delete', outcome: 'monitored' });
}
const app = createApp({
  config: { PUBLIC_URL: 'http://localhost:3102', SESSION_SECRET: randomBytes(32).toString('hex'), TRUST_PROXY: 0, NODE_ENV: 'development' },
  store, discord: demoDiscord(),
  classify: async () => { throw Object.assign(new Error('Preview has no Jev connection. Start the configured app to test messages.'), { status: 409 }); },
  health: () => ({ connected: false, lastIssue: null }),
  demo: { user: { id: '600000000000000001', name: 'Demo moderator', username: 'demo' }, guilds: demoGuilds },
});
app.listen(3102, '127.0.0.1', () => console.log('Jev-Mod preview: http://localhost:3102 — sample data, no Discord or Jev connection.'));
