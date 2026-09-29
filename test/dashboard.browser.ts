import { defaultSettings } from '../packages/core/src/policy.ts';
import type { CaseRecord, DashboardData } from '../packages/core/src/types.ts';

const authError = new URLSearchParams(location.search).has('authError');
const guildId = '100000000000000001';
const secondGuildId = '100000000000000002';
const channelId = '200000000000000001';
const forumId = '200000000000000002';
const missingChannel = '200000000000000009';
const missingRole = '300000000000000009';
const now = Date.UTC(2026, 8, 28, 12);
function cases(last: number, count: number): CaseRecord[] {
  return Array.from({ length: count }, (_, index) => {
    const id = last - index;
    return { id, guild_id: guildId, channel_id: id === 5 ? forumId : channelId,
      message_id: String(400000000000000000n + BigInt(id)), author_id: '500000000000000001',
      message_hash: 'a'.repeat(64), message_revision: String(now + id), policy_version: 1,
      content: id === 5 ? 'Sample archived phishing report' : `Sample case ${id}`,
      matches: [{ id: id === 5 ? 'scams' : 'spam', name: id === 5 ? 'Scams & phishing' : 'Spam & promotion', probability: 0.96, action: 'delete' }], model: null,
      requested_action: 'delete', outcome: id === 5 ? 'delete_failed' : id === 6 ? 'deleted' : 'monitored', reviewed_by: null, created_at: now + id };
  });
}
const data: DashboardData = {
  version: 1, settings: { ...defaultSettings(), mode: 'protect', exemptChannels: [channelId, missingChannel],
    exemptRoles: [missingRole], logChannelId: missingChannel },
  metadata: { id: guildId, name: 'Sample regression server', channels: [
    { id: channelId, name: 'general', sendable: true }, { id: forumId, name: 'forum', sendable: false },
    ...Array.from({ length: 2000 }, (_, index) => ({ id: String(210000000000000000n + BigInt(index)), name: `sample-project-${String(index).padStart(4, '0')}`, sendable: true })),
  ], roles: Array.from({ length: 2000 }, (_, index) => ({ id: String(310000000000000000n + BigInt(index)), name: `Sample team ${String(index).padStart(4, '0')}` })), permissions: { manageMessages: true, moderateMembers: true } },
  stats: { total: 100, removed: 1, review: 99 }, audit: [], health: { connected: false }, demo: false, keyStatus: { source: 'missing' },
};
const otherData: DashboardData = { ...data, settings: defaultSettings(), metadata: { ...data.metadata, id: secondGuildId, name: 'Second sample server' }, stats: { total: 0, removed: 0, review: 0 } };
let allCases = cases(100, 100);
let saves = 0;
let signOuts = 0;
let confirmations = 0;
let approveDiscard = false;
let pending: { resolve(value: Response): void; signal: AbortSignal } | undefined;
let pendingSearch: { resolve(value: Response): void; signal: AbortSignal } | undefined;
let keySaves = 0;
let keyRemovals = 0;
let failKeySave = false;
const queries: URLSearchParams[] = [];
const cursors: number[] = [];
window.confirm = () => { confirmations++; return approveDiscard; };
window.fetch = async (input, options) => {
  const url = new URL(input instanceof Request ? input.url : String(input), location.origin);
  const method = options?.method ?? (input instanceof Request ? input.method : 'GET');
  if (url.pathname === '/api/session') return Response.json({ user: { id: '600000000000000001', name: 'Sample moderator' }, demo: false, inviteUrl: null });
  if (url.pathname === '/api/guilds') return authError ? Response.json({ error: 'Discord access revoked' }, { status: 401 })
    : Response.json([{ id: guildId, name: data.metadata.name, installed: true, inviteUrl: null }, { id: secondGuildId, name: otherData.metadata.name, installed: true, inviteUrl: null }]);
  if (url.pathname === `/api/guilds/${guildId}`) return Response.json(data);
  if (url.pathname === `/api/guilds/${secondGuildId}`) return Response.json(otherData);
  if (url.pathname === `/api/guilds/${guildId}/settings` && method === 'PUT') {
    const { settings } = JSON.parse(String(options?.body));
    if (settings.exemptChannels.includes(missingChannel) || settings.exemptRoles.includes(missingRole) || settings.logChannelId === missingChannel) {
      return Response.json({ error: 'Unavailable selection' }, { status: 400 });
    }
    saves++; data.settings = settings; data.version++;
    return Response.json({ settings, version: data.version });
  }
  if (url.pathname === `/api/guilds/${guildId}/key` && ['PUT', 'DELETE'].includes(method)) {
    if (method === 'PUT') {
      if (failKeySave) return Response.json({ error: 'Sample key save failure' }, { status: 500 });
      assert(JSON.parse(String(options?.body)).key.startsWith('sample-only-'), 'Only sample keys are submitted');
      keySaves++; data.keyStatus = { source: 'server' };
    } else if (method === 'DELETE') { keyRemovals++; data.keyStatus = { source: 'operator' }; }
    return Response.json(data.keyStatus);
  }
  if (url.pathname === `/api/guilds/${secondGuildId}/cases`) return Response.json([]);
  if (url.pathname === `/api/guilds/${guildId}/cases`) {
    const query = new URLSearchParams(url.search); queries.push(query);
    const before = Number(query.get('before'));
    if (before) cursors.push(before);
    if (before === 51 && !pending) return new Promise<Response>(resolve => { pending = { resolve, signal: options!.signal! }; });
    if (query.get('search') === 'hold') return new Promise<Response>(resolve => { pendingSearch = { resolve, signal: options!.signal! }; });
    const outcome = query.get('outcome');
    const rows = allCases.filter(item => (!before || Number(item.id) < before)
      && (!query.get('search') || item.content.toLowerCase().includes(query.get('search')!.toLowerCase()))
      && (!outcome || (outcome === 'review' ? ['monitored', 'logged', 'delete_failed'].includes(item.outcome) : outcome === 'removed' ? item.outcome.startsWith('deleted') : item.outcome === outcome))
      && (!query.get('rule') || item.matches.some(match => match.id === query.get('rule')))
      && (!query.get('channel') || item.channel_id === query.get('channel'))
      && (!query.get('from') || Number(item.created_at) >= Number(query.get('from')))
      && (!query.get('to') || Number(item.created_at) <= Number(query.get('to'))));
    return Response.json(rows.slice(0, 50));
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
function namedButton(label: string) {
  const result = [...document.querySelectorAll('button')].find(item => item.getAttribute('aria-label') === label);
  assert(result, `Missing button: ${label}`); return result!;
}
function checkbox(label: string) {
  const result = [...document.querySelectorAll('label')].find(item => item.textContent?.startsWith(label))?.querySelector('input');
  assert(result, `Missing checkbox: ${label}`); return result!;
}
function select(label: string) {
  const result = [...document.querySelectorAll('label')].find(item => item.textContent?.startsWith(label))?.querySelector('select');
  assert(result, `Missing field: ${label}`); return result!;
}
function findInput(label: string) {
  return [...document.querySelectorAll('label')].find(item => item.textContent?.startsWith(label))?.querySelector('input');
}
function input(label: string) {
  const result = findInput(label);
  assert(result, `Missing field: ${label}`); return result!;
}
function selectByName(label: string) {
  const result = [...document.querySelectorAll('select')].find(item => item.getAttribute('aria-label') === label);
  assert(result, `Missing select: ${label}`); return result!;
}
function changeSelect(element: HTMLSelectElement, value: string) { element.value = value; element.dispatchEvent(new Event('change', { bubbles: true })); }
function changeInput(element: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
}
async function tab(label: string) { button(label).click(); await settle(); }
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
  assert(document.querySelectorAll('.check-list input').length === 80, 'Thousands of sample options must render at most 40 per selector');
  namedButton(`Remove ${missingChannel}`).click(); await settle();
  namedButton(`Remove ${missingRole}`).click(); await settle();
  assert(checkbox('# general').checked, 'Existing exemptions must remain selected');
  checkbox('# forum').click(); await settle();
  changeInput(input('Search exempt channels'), 'sample-project-1999'); await settle();
  assert(document.querySelectorAll('.exceptions:first-of-type .check-list input').length <= 40, 'Filtered options stay bounded');
  checkbox('# sample-project-1999').click(); await settle();
  changeInput(input('Search exempt channels'), ''); await settle();
  assert(namedButton('Remove # sample-project-1999'), 'Selected channels remain available after search changes');
  changeInput(input('Search exempt roles'), '310000000000001999'); await settle();
  checkbox('Sample team 1999').click(); await settle();
  changeInput(input('Search exempt roles'), 'no result'); await settle();
  assert(namedButton('Remove Sample team 1999'), 'Role ID search retains selections outside current results');
  namedButton('Remove Sample team 1999').click(); await settle();
  button('Exceptions').focus();
  button('Exceptions').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); await settle();
  assert(document.activeElement?.textContent === 'Content filters' && button('Content filters').getAttribute('aria-selected') === 'true', 'Settings tabs support arrow-key focus and selection');
  changeInput(input('Add phrase'), 'Sample phrase'); await settle(); button('Add phrase').click(); await settle();
  changeInput(input('Add phrase'), 'SAMPLE PHRASE'); await settle(); button('Add phrase').click(); await settle();
  assert(document.querySelector('[role="alert"]')?.textContent === 'This phrase is already blocked.', 'Phrases reject case-insensitive duplicates');
  changeInput(input('Add phrase'), ''); await settle();
  checkbox('Limit mentions').click(); await settle();
  assert(![...document.querySelectorAll('label')].some(label => label.textContent?.startsWith('Act at this many mentions')), 'Mention toggle hides disabled limit');
  checkbox('Limit mentions').click(); await settle();
  changeInput(input('Act at this many mentions'), '12'); await settle();
  changeSelect(select('Action for content filters'), 'timeout'); await settle();
  changeInput(input('Shared timeout duration'), '25'); await settle();
  await tab('Actions/logs');
  assert(input('Shared timeout duration').value === '25', 'Timeout duration is shared across settings tabs');
  const log = select('Moderator log channel');
  assert(![...log.options].some(option => option.value === forumId), 'Forum must not be a log destination');
  assert(log.selectedOptions[0].textContent?.startsWith('Unavailable'), 'Missing log channel must be visible');
  changeSelect(log, ''); await settle();
  await tab('Content filters');
  assert(namedButton('Remove phrase Sample phrase') && input('Act at this many mentions').value === '12', 'Tab changes retain unsaved filters');
  await view('rules', 'Auto moderation');
  changeSelect(selectByName('Scams & phishing action'), 'timeout'); await settle();
  assert(input('Scams & phishing shared timeout').value === '25', 'Rule timeout actions expose shared duration');
  changeSelect(selectByName('Moderation mode'), 'off'); await settle();
  button('Save changes').click();
  await until(() => saves === 1 && !document.querySelector('.savebar'));
  assert(data.settings.mode === 'off' && data.settings.exemptRoles.length === 0 && !data.settings.exemptChannels.includes(missingChannel), 'Removed selections allow saving paused mode');
  assert(data.settings.exemptChannels.includes(forumId) && data.settings.timeoutMinutes === 25 && data.settings.blockedPhrases[0] === 'Sample phrase', 'Saved settings retain exceptions, phrases and shared timeout');

  await view('settings', 'Server settings'); await tab('API key');
  changeInput(input('Server API key'), 'sample-only-key-one'); await settle(); button('Save API key').click();
  await until(() => keySaves === 1 && findInput('Replace server key')?.value === '' && document.querySelector('.key-status')?.textContent === 'Server key configured');
  assert(document.querySelector('.key-status')?.textContent === 'Server key configured', 'Key save shows status and clears password');
  failKeySave = true; changeInput(input('Replace server key'), 'sample-only-key-two'); await settle(); button('Save API key').click();
  await until(() => document.querySelector('[role="alert"]')?.textContent === 'Sample key save failure');
  assert(input('Replace server key').value === 'sample-only-key-two' && !button('Save API key').disabled, 'Failed key save stays retryable');
  failKeySave = false; button('Save API key').click(); await until(() => keySaves === 2 && findInput('Replace server key')?.value === '');
  button('Remove API key').click(); await until(() => keyRemovals === 1 && document.querySelector('.key-status')?.textContent === 'Using operator key');
  changeInput(input('Server API key'), 'sample-only-unsaved'); await settle();
  changeSelect(selectByName('Select server'), secondGuildId);
  await until(() => location.pathname.includes(secondGuildId) && document.querySelector('h1')?.textContent === 'Server settings'); await tab('API key');
  assert(input('Server API key').value === '', 'Server switch clears secret input');
  changeSelect(selectByName('Select server'), guildId);
  await until(() => location.pathname.includes(guildId) && document.querySelector('h1')?.textContent === 'Server settings');

  await view('rules', 'Auto moderation');
  changeSelect(selectByName('Moderation mode'), 'monitor'); await settle();
  await view('activity', 'Moderation activity'); await until(() => document.querySelectorAll('tbody tr').length === 50);
  const region = document.querySelector<HTMLElement>('.case-region')!;
  assert(region.scrollHeight > region.clientHeight && getComputedStyle(region).overflowY === 'auto', 'Cases scroll inside bounded region');
  assert(getComputedStyle(document.querySelector('th')!).position === 'sticky', 'Case headings stay visible during scrolling');
  button('Load older cases').click(); await until(() => pending);
  allCases = cases(105, 105); data.stats = { total: 105, removed: 1, review: 104 };
  button('Refresh').click();
  await until(() => document.querySelector('.case-link')?.textContent?.includes('#105'));
  await until(() => pending?.signal.aborted);
  pending!.resolve(Response.json(cases(50, 50))); await settle();
  assert(document.querySelectorAll('tbody tr').length === 50, 'Old response must not append to refreshed list');
  button('Load older cases').click(); await until(() => document.querySelectorAll('tbody tr').length === 100);
  button('Load older cases').click(); await until(() => document.querySelectorAll('tbody tr').length === 105);
  const ids = [...document.querySelectorAll('.case-link span')].map(item => Number(item.textContent?.split('#')[1]));
  assert(ids.every((id, index) => id === 105 - index), 'Refreshed pagination contains every case in order');
  assert(cursors.join(',') === '51,56,6', 'Pagination restarts from refreshed cursor');
  changeInput(input('Search cases'), 'archived phishing'); await until(() => document.querySelectorAll('tbody tr').length === 1);
  assert(document.querySelector('.case-link')?.textContent?.includes('#5'), 'Server search finds cases beyond first page');
  assert(queries.at(-1)?.get('search') === 'archived phishing', 'Search is sent to server');
  changeSelect(select('Outcome'), 'delete_failed'); changeSelect(select('Rule'), 'scams'); changeInput(input('Channel'), forumId);
  changeInput(input('From'), '2026-09-28'); changeInput(input('Through'), '2026-09-28');
  await until(() => queries.at(-1)?.get('channel') === forumId && queries.at(-1)?.get('from'));
  await until(() => document.querySelectorAll('tbody tr').length === 1);
  assert(queries.at(-1)?.get('rule') === 'scams' && queries.at(-1)?.get('outcome') === 'delete_failed', 'Case filters are server-side');
  button('Clear filters').click(); await until(() => document.querySelectorAll('tbody tr').length === 50);
  changeInput(input('Search cases'), 'hold'); await until(() => pendingSearch);
  changeInput(input('Search cases'), 'archived phishing'); await until(() => document.querySelectorAll('tbody tr').length === 1);
  assert(pendingSearch!.signal.aborted, 'Query changes cancel stale searches');
  pendingSearch!.resolve(Response.json(cases(90, 50))); await settle();
  assert(document.querySelectorAll('tbody tr').length === 1 && document.querySelector('.case-link')?.textContent?.includes('#5'), 'Stale search responses are discarded');

  await view('rules', 'Auto moderation');
  assert(selectByName('Moderation mode').value === 'monitor', 'Activity refresh must preserve unsaved settings');
  const signOut = button('Sign out');
  const bounds = signOut.getBoundingClientRect();
  assert(signOut.checkVisibility() && bounds.width > 0 && bounds.height > 0, 'Sign out stays visible at this viewport width');
  assert(bounds.left >= 0 && bounds.right <= innerWidth, 'Sign out stays inside viewport');
  changeSelect(selectByName('Moderation mode'), 'protect'); await settle();
  button('Sign out').click(); await settle();
  assert(confirmations === 1 && signOuts === 0, 'Cancel retains session without sign-out request');
  assert(button('Save changes'), 'Cancel retains draft');
  const blocked = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(blocked);
  assert(blocked.defaultPrevented, 'Canceled sign-out retains unload protection');
  button('Save changes').click(); await until(() => saves === 2 && !document.querySelector('.savebar'));
  changeSelect(selectByName('Moderation mode'), 'monitor'); await settle();
  approveDiscard = true; button('Sign out').click();
  await until(() => signOuts === 1 && !button('Sign out').disabled);
  assert(confirmations === 2 && button('Save changes'), 'Failed sign-out retains draft');
  const stillBlocked = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(stillBlocked);
  assert(stillBlocked.defaultPrevented, 'Failed sign-out retains unload protection');
  document.getElementById('test-result')!.textContent = 'PASS: bounded exceptions, accessible tabs, filters, timeout, API keys, pagination, stale search, and sign-out';
}
run().catch(error => { document.getElementById('test-result')!.textContent = `FAIL: ${error.message}`; console.error(error); });
