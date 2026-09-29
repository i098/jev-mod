import { z } from 'zod';

export const catalog = [
  { id: 'scams', name: 'Scams & phishing', description: 'Credential theft, fake giveaways, fraudulent offers, and deceptive payment requests.' },
  { id: 'spam', name: 'Spam & promotion', description: 'Unsolicited advertisements, disruptive spam, and irrelevant mass promotion.' },
  { id: 'hate', name: 'Hate speech', description: 'Attacks or dehumanization targeting protected characteristics. Do not flag neutral discussion or reporting.' },
  { id: 'harassment', name: 'Harassment', description: 'Targeted abusive insults, bullying, or persistent intimidation. Do not flag ordinary disagreement.' },
  { id: 'threats', name: 'Violent threats', description: 'Credible threats or encouragement of physical violence against a person or group.' },
  { id: 'sexual', name: 'Explicit sexual content', description: 'Sexually explicit descriptions or sexual solicitation. Do not flag neutral health or educational discussion.' },
] as const;

export const snowflake = z.string().regex(/^\d{17,20}$/);
const action = z.enum(['log', 'delete', 'timeout']);
export const settingsSchema = z.object({
  mode: z.enum(['monitor', 'protect', 'off']),
  rules: z.array(z.object({
    id: z.enum(catalog.map(rule => rule.id)),
    enabled: z.boolean(),
    threshold: z.number().min(0.5).max(1),
    action,
    instructions: z.string().trim().min(10).max(1000),
  }).strict()).length(catalog.length).refine(rules => new Set(rules.map(rule => rule.id)).size === catalog.length),
  exemptChannels: z.array(snowflake).max(100),
  exemptRoles: z.array(snowflake).max(100),
  blockedPhrases: z.array(z.string().trim().min(2).max(100)).max(100),
  mentionLimit: z.number().int().min(0).max(50),
  localAction: action,
  timeoutMinutes: z.number().int().min(1).max(40320),
  logChannelId: z.union([snowflake, z.literal('')]),
}).strict();

export type Settings = z.infer<typeof settingsSchema>;
export type Rule = Settings['rules'][number];
export type Match = { id: string; name: string; probability: number; action: Rule['action']; threshold?: number };
export type MessageSnapshot = { id: string; guildId: string; channelId: string; parentId?: string | null;
  authorId: string; bot?: boolean; roleIds: string[]; content: string; mentionCount: number };

export function defaultSettings(): Settings {
  return {
    mode: 'monitor',
    rules: catalog.map(rule => ({ ...{ id: rule.id, enabled: true, threshold: 0.9, action: 'delete' }, instructions: rule.description })),
    exemptChannels: [], exemptRoles: [], blockedPhrases: [], mentionLimit: 8,
    localAction: 'delete', timeoutMinutes: 10, logChannelId: '',
  };
}

export function isExempt(message: MessageSnapshot, settings: Settings) {
  return message.bot || !message.guildId || settings.mode === 'off'
    || settings.exemptChannels.includes(message.channelId)
    || (message.parentId != null && settings.exemptChannels.includes(message.parentId))
    || message.roleIds.some(role => settings.exemptRoles.includes(role));
}

export function localMatches(message: Pick<MessageSnapshot, 'content' | 'mentionCount'>, settings: Settings): Match[] {
  const matches: Match[] = [];
  const text = message.content.normalize('NFKC').toLocaleLowerCase('en-US');
  if (settings.blockedPhrases.some(phrase => text.includes(phrase.normalize('NFKC').toLocaleLowerCase('en-US')))) {
    matches.push({ id: 'phrases', name: 'Blocked phrase', probability: 1, action: settings.localAction });
  }
  if (settings.mentionLimit > 0 && message.mentionCount >= settings.mentionLimit) {
    matches.push({ id: 'mentions', name: 'Excessive mentions', probability: 1, action: settings.localAction });
  }
  return matches;
}

export function strongestAction(matches: Match[]): Rule['action'] {
  if (matches.some(match => match.action === 'timeout')) return 'timeout';
  return matches.some(match => match.action === 'delete') ? 'delete' : 'log';
}

export function canManage(guild: { owner?: boolean; permissions?: string }) {
  if (guild.owner) return true;
  try { return (BigInt(guild.permissions ?? '') & (8n | 32n)) !== 0n; }
  catch { return false; }
}
