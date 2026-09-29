import { defaultSettings } from '../packages/core/src/policy.ts';
import type { CaseRecord, DashboardData } from '../packages/core/src/types.ts';

const authError = new URLSearchParams(location.search).has('authError');
const guildId = '100000000000000001';
const channelId = '200000000000000001';
const forumId = '200000000000000002';
const missingChannel = '200000000000000009';
const missingRole = '300000000000000009';
function cases(last: number, count: number): CaseRecord[] {
  return Array.from({ length: count }, (_, index) => ({ id: last - index, guild_id: guildId, channel_id: channelId,
    message_id: String(400000000000000000n + BigInt(last - index)), author_id: '500000000000000001',
    message_hash: 'a'.repeat(64), policy_version: 1, content: `Case ${last - index}`, matches: [], model: null,
    requested_action: 'delete', outcome: 'monitored', reviewed_by: null, created_at: Date.now() }));
}
const data: DashboardData = {
  version: 1, settings: { ...defaultSettings(), mode: 'protect', exemptChannels: [channelId, missingChannel],
    exemptRoles: [missingRole], logChannelId: missingChannel },
  metadata: { id: guildId, name: 'Regression server', channels: [
    { id: channelId, name: 'general', sendable: true }, { id: forumId, name: 'forum', sendable: false },
  ], roles: [], permissions: { manageMessages: true, moderateMembers: true } },
  cases: cases(100, 50), stats: { total: 100, removed: 0, review: 100 }, audit: [], health: { connected: false }, demo: false,
};
let saves = 0;
let signOuts = 0;
let confirmations = 0;
let approveDiscard = false;
let pending: { resolve(value: Response): void; signal: AbortSignal } | undefined;
const cursors: number[] = [];
window.confirm = () => { confirmations++; return approveDiscard; };
window.fetch = async (input, options) => {
  const url = new URL(input instanceof Request ? input.url : String(input), location.origin);
  const method = options?.method ?? (input instanceof Request ? input.method : 'GET');
  if (url.pathname === '/api/session') return Response.json({ user: { id: '600000000000000001', name: 'Test moderator' }, demo: false, inviteUrl: null });
  if (url.pathname === '/api/guilds') return authError ? Response.json({ error: 'Discord access revoked' }, { status: 401 })
    : Response.json([{ id: guildId, name: data.metadata.name, installed: true, inviteUrl: null }]);
  if (url.pathname === `/api/guilds/${guildId}`) return Response.json(data);
  if (url.pathname === `/api/guilds/${guildId}/settings` && method === 'PUT') {
    const { settings } = JSON.parse(String(options?.body));
    if (settings.exemptChannels.includes(missingChannel) || settings.exemptRoles.includes(missingRole) || settings.logChannelId === missingChannel) {
      return Response.json({ error: 'Unavailable selection' }, { status: 400 });
    }
    saves++; data.settings = settings; data.version++;
    return Response.json({ settings, version: data.version });
  }
  if (url.pathname === `/api/guilds/${guildId}/cases`) {
    const before = Number(url.searchParams.get('before'));
    cursors.push(before);
    if (before === 51) return new Promise<Response>(resolve => { pending = { resolve, signal: options!.signal! }; });
    return Response.json(cases(before - 1, Math.min(before - 1, 50)));
  }
  if (url.pathname === '/api/auth/sign-out') {
    signOuts++;
    return Response.json({ code: 'TEST_FAILURE', message: 'Test sign-out failed' }, { status: 400 });
  }
  throw new Error(`Unexpected request: ${method} ${url.pathname}`);
};

function assert(value: unknown, message: string) { if (!value) throw new Error(message); }
async function until(check: () => unknown) {
  const deadline = performance.now() + 5000;
  while (!check()) {
    assert(performance.now() < deadline, `Timed out: ${check}`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
const settle = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
function button(label: string) {
  const result = [...document.querySelectorAll('button')].find(item => item.textContent === label);
  assert(result, `Missing button: ${label}`);
  return result!;
}
function checkbox(label: string) {
  const result = [...document.querySelectorAll('label')].find(item => item.textContent === label)?.querySelector<HTMLInputElement>('input');
  assert(result, `Missing checkbox: ${label}`);
  return result!;
}
function select(label: string) {
  const result = [...document.querySelectorAll('label')].find(item => item.textContent?.startsWith(label))?.querySelector('select');
  assert(result, `Missing select: ${label}`);
  return result!;
}
function changeSelect(input: HTMLSelectElement, value: string) { input.value = value; input.dispatchEvent(new Event('change', { bubbles: true })); }
async function view(name: string, title: string) {
  const link = document.querySelector<HTMLAnchorElement>(`a[href="/servers/${guildId}/${name}"]`);
  assert(link, `Missing view: ${name}`); link!.click();
  await until(() => document.querySelector('h1')?.textContent === title);
}
async function run() {
  history.replaceState({}, '', `/servers/${guildId}/settings`);
  await import('../apps/web/src/main.tsx');
  if (authError) {
    await until(() => document.querySelector('h1')?.textContent === 'Jev-Mod could not load');
    assert(button('Sign out').checkVisibility(), 'Loading errors must expose sign-out');
    button('Sign out').click();
    await until(() => signOuts === 1 && !button('Sign out').disabled);
    assert(document.querySelector('[role="alert"]')?.textContent === 'Test sign-out failed', 'Sign-out failures must stay visible and retryable');
    document.getElementById('test-result')!.textContent = 'PASS: revoked OAuth access exposes a working, retryable sign-out action';
    return;
  }
  await until(() => document.querySelector('h1')?.textContent === 'Server settings');
  assert(checkbox(`Unavailable · ${missingChannel}`).checked, 'Missing channel must stay visible and selected');
  assert(checkbox(`Unavailable · ${missingRole}`).checked, 'Missing role must stay visible and selected');
  checkbox(`Unavailable · ${missingChannel}`).click(); await settle();
  checkbox(`Unavailable · ${missingRole}`).click(); await settle();
  assert(checkbox('# general').checked, 'Existing exemptions must remain selected');
  checkbox('# forum').click(); await settle();
  const log = select('Moderator log channel');
  assert(![...log.options].some(option => option.value === forumId), 'Forum must not be a log destination');
  assert(log.selectedOptions[0].textContent?.startsWith('Unavailable'), 'Missing log channel must be visible');
  changeSelect(log, ''); await settle();
  await view('rules', 'Auto moderation');
  changeSelect(document.querySelector<HTMLSelectElement>('[aria-label="Moderation mode"]')!, 'off'); await settle();
  button('Save changes').click();
  await until(() => saves === 1 && !document.querySelector('.savebar'));
  assert(data.settings.mode === 'off' && data.settings.exemptRoles.length === 0 && !data.settings.exemptChannels.includes(missingChannel), 'Removed selections must allow saving paused mode');
  assert(data.settings.exemptChannels.includes(forumId), 'Forum exemption must be saved');

  await view('activity', 'Moderation activity');
  button('Load older cases').click(); await until(() => pending);
  data.cases = cases(105, 50);
  button('Refresh').click();
  await until(() => document.querySelector('.case-link')?.textContent?.includes('#105'));
  await until(() => pending?.signal.aborted);
  pending!.resolve(Response.json(cases(50, 50))); await settle();
  assert(document.querySelectorAll('tbody tr').length === 50, 'Old response must not append to refreshed list');
  button('Load older cases').click(); await until(() => document.querySelectorAll('tbody tr').length === 100);
  button('Load older cases').click(); await until(() => document.querySelectorAll('tbody tr').length === 105);
  const ids = [...document.querySelectorAll('.case-link span')].map(item => Number(item.textContent?.split('#')[1]));
  assert(ids.every((id, index) => id === 105 - index), 'Refreshed pagination must contain every case in order');
  assert(cursors.join(',') === '51,56,6', 'Pagination must restart from refreshed cursor');

  await view('rules', 'Auto moderation');
  const signOut = button('Sign out');
  const bounds = signOut.getBoundingClientRect();
  assert(signOut.checkVisibility() && bounds.width > 0 && bounds.height > 0, 'Sign out must stay visible at this viewport width');
  assert(bounds.left >= 0 && bounds.right <= innerWidth, 'Sign out must stay inside the viewport');
  changeSelect(document.querySelector<HTMLSelectElement>('[aria-label="Moderation mode"]')!, 'protect'); await settle();
  button('Sign out').click(); await settle();
  assert(confirmations === 1 && signOuts === 0, 'Cancel must retain session without a sign-out request');
  assert(button('Save changes'), 'Cancel must retain draft');
  const blocked = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(blocked);
  assert(blocked.defaultPrevented, 'Canceled sign-out must retain unload protection');
  button('Save changes').click(); await until(() => saves === 2 && !document.querySelector('.savebar'));
  changeSelect(document.querySelector<HTMLSelectElement>('[aria-label="Moderation mode"]')!, 'monitor'); await settle();
  approveDiscard = true;
  button('Sign out').click();
  await until(() => signOuts === 1 && !button('Sign out').disabled);
  assert(confirmations === 2 && button('Save changes'), 'Failed sign-out must retain draft');
  const stillBlocked = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(stillBlocked);
  assert(stillBlocked.defaultPrevented, 'Failed sign-out must retain unload protection');
  document.getElementById('test-result')!.textContent = 'PASS: unavailable selections, forum choices, refreshed pagination, canceled and failed sign-out';
}
run().catch(error => { document.getElementById('test-result')!.textContent = `FAIL: ${error.message}`; console.error(error); });
