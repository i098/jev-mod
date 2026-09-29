import type { Match, Settings } from './policy.ts';
export type PolicyRecord = { settings: Settings; version: number };
export type CaseRecord = {
  id: number | string; guild_id: string; channel_id: string; message_id: string; author_id: string;
  message_hash: string; policy_version: number; content: string; matches: Match[]; model: string | null;
  requested_action: string; outcome: string; reviewed_by: string | null; created_at: number | string;
};
export type NewCase = { guildId: string; channelId: string; messageId: string; authorId: string;
  messageHash: string; policyVersion: number; content: string; matches: Match[]; model: string | null;
  requestedAction: string; outcome: string };
export type Guild = { id: string; name: string; installed: boolean; inviteUrl: string | null };
export type GuildMetadata = { id: string; name: string; channels: { id: string; name: string; sendable: boolean }[];
  roles: { id: string; name: string }[]; permissions: { manageMessages: boolean; moderateMembers: boolean } };
export type Decision = { model: string | null; matches: Match[]; scores: Match[] };
export type DashboardData = PolicyRecord & {
  metadata: GuildMetadata; cases: CaseRecord[];
  stats: { total: number; removed: number; review: number };
  audit: { id: number; actor_id: string; event: string; created_at: number }[];
  health: { connected: boolean }; demo: boolean;
};
export type SessionInfo = { user: { id: string; name: string } | null; demo: boolean; inviteUrl: string | null };
