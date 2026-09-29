import { createAuthClient } from 'better-auth/react';
import type { CaseRecord } from '@jev-mod/core/types.ts';

export const authClient = createAuthClient();
export class ApiError extends Error { constructor(message: string, readonly status: number) { super(message); } }
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', ...options,
    headers: { 'Content-Type': 'application/json', 'x-jev-request': 'dashboard', ...options.headers } });
  const data = await response.json().catch(() => ({ error: 'Server response could not be read.' }));
  if (!response.ok) {
    const message = data && typeof data === 'object' && 'error' in data && typeof data.error === 'string' ? data.error : 'Request failed.';
    throw new ApiError(message, response.status);
  }
  return data as T;
}
export const actionLabels = { log: 'Log only', delete: 'Delete message', timeout: 'Delete + timeout' };
export const outcomeLabels: Record<string, string> = {
  monitored: 'For review', logged: 'Logged', deleted: 'Deleted', deleted_timed_out: 'Deleted + timeout',
  deleted_timeout_failed: 'Deleted · timeout failed', deleted_timeout_skipped: 'Deleted · timeout skipped',
  delete_failed: 'Delete failed', missing_permission: 'Missing permission', member_check_failed: 'Member check failed',
  policy_changed: 'Policy changed', message_changed: 'Message edited', exempt: 'Now exempt', already_gone: 'Already gone',
  dismissed: 'Dismissed', interrupted: 'Interrupted', pending: 'Pending', reviewing: 'Being reviewed',
};
export const reviewable = (item: CaseRecord) => ['monitored', 'logged', 'delete_failed'].includes(item.outcome);
export const percentage = (number: number) => `${Math.round(number * 100)}%`;
export const date = (value: number | string) => new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
