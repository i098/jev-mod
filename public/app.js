const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const date = value => new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const percent = value => `${Math.round(value * 100)}%`;
const actions = { log: 'Log only', delete: 'Delete message', timeout: 'Delete + timeout' };
const outcomes = { monitored: 'For review', logged: 'Logged', deleted: 'Deleted', deleted_timed_out: 'Deleted + timeout',
  deleted_timeout_failed: 'Deleted · timeout failed', delete_failed: 'Delete failed', missing_permission: 'Missing permission',
  deleted_timeout_skipped: 'Deleted · timeout skipped', member_check_failed: 'Member check failed',
  policy_changed: 'Policy changed', message_changed: 'Message edited', exempt: 'Now exempt', already_gone: 'Already gone',
  dismissed: 'Dismissed', interrupted: 'Interrupted', pending: 'Pending', reviewing: 'Being reviewed', demo_no_action: 'Preview · no action' };
const reviewable = item => ['monitored', 'logged', 'delete_failed'].includes(item.outcome);
const state = { session: null, guilds: [], guildId: '', view: 'rules', data: null, draft: null, dirty: false, filter: 'all', epoch: 0, busy: false };
let requestController;
let noticeTimer;
const shield = '<svg class="brand-mark" viewBox="0 0 32 36" fill="none" aria-hidden="true"><path d="M16 2 29 7v10c0 8-8 14-13 17C11 31 3 25 3 17V7L16 2Z" stroke="currentColor" stroke-width="1.8"/><path d="m10 17 4 4 8-9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const brand = `<a class="brand" href="/" aria-label="Jev-Mod home">${shield}<span>jev<span>·</span>mod</span></a>`;
const icon = name => `<svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true">${{
  rules: '<path d="M12 3 20 6v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
  activity: '<path d="M4 5h16M4 12h16M4 19h10"/><circle cx="19" cy="19" r="2"/>',
  settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="var(--canvas)"/><circle cx="16" cy="17" r="3" fill="var(--canvas)"/>',
}[name]}</svg>`;

async function api(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', ...options,
    headers: { 'Content-Type': 'application/json', ...(state.session?.csrf ? { 'x-csrf-token': state.session.csrf } : {}), ...options.headers } });
  const body = await response.json().catch(() => ({ error: 'Server response could not be read.' }));
  if (!response.ok) {
    if (response.status === 401) {
      state.data = null; state.draft = null; state.dirty = false;
      login('Your session expired. Sign in again.');
    }
    throw new Error(body.error ?? 'Request failed.');
  }
  return body;
}
function notice(message, error = false) {
  clearTimeout(noticeTimer);
  const node = $('#notice');
  node.textContent = message;
  node.classList.toggle('error', error);
  node.hidden = false;
  noticeTimer = setTimeout(() => { node.hidden = true; }, 6000);
}
function login(message = '') {
  $('#app').innerHTML = `<main id="main" class="login">${brand}<div class="eyebrow">Your community. Your rules.</div>
    <h1>Keep the conversation<br>worth having.</h1>
    <p>Discord moderation that understands what a message means.
    Set your rules, try them on a message, and let Jev-Mod handle the noise.</p>
    ${message ? `<p class="error">${esc(message)}</p>` : ''}
    <a class="button primary" href="/auth/login">Continue with Discord</a>
    ${state.session?.inviteUrl ? `<a class="button" href="${esc(state.session.inviteUrl)}">Add to Discord</a>` : ''}
    <ul><li>Separate rules and logs for every server</li><li>Start in monitoring mode, then enable enforcement</li><li>Powered by TypeSafe Jev · Text moderation</li></ul>
    <p class="small">Manage Server permission is required to configure a server.
    Message text is sent to TypeSafe for evaluation.
    Flagged evidence is kept for 30 days.</p></main>`;
}
function shell() {
  $('#app').innerHTML = `<div class="shell"><aside class="sidebar">${brand}<p class="brand-subtitle">Community, with boundaries.</p>
    <div><label class="server-label" for="server">YOUR SERVER</label><select id="server" class="server-select" aria-label="Select server">${state.guilds.map(guild => `<option value="${esc(guild.id)}">${esc(guild.name)}${guild.installed ? '' : ' · Add bot'}</option>`).join('')}</select></div>
    <nav class="nav" aria-label="Dashboard"><button data-view="rules">${icon('rules')}Auto moderation</button>
    <button data-view="activity">${icon('activity')}Activity <span class="nav-count" id="review-count">0</span></button>
    <button data-view="settings">${icon('settings')}Server settings</button></nav>
    <div class="sidebar-bottom"><div class="connection" id="connection"><span class="dot"></span>Checking connection</div>
    <div class="user-row"><div class="user-avatar">${esc((state.session.user.name ?? 'M').slice(0, 2).toUpperCase())}</div><div><div class="small">${esc(state.session.user.name ?? state.session.user.username)}</div><button data-action="logout">Sign out</button></div></div></div></aside>
    <div class="workspace">${state.session.demo ? '<div class="demo-banner"><strong>Local preview</strong> · Sample servers and cases. No Discord or Jev connection. Changes reset on restart.</div>' : ''}
    <header class="topbar"><div><span id="guild-name"></span> <span aria-hidden="true"> / </span> <strong id="page-name"></strong></div><span id="mode-badge"></span></header>
    <main id="main" class="content" tabindex="-1"></main>
    <footer id="savebar" class="savebar" hidden><p>Unsaved changes<br><span class="muted">Apply to this server only.</span></p><div class="actions"><button data-action="discard" class="quiet">Discard</button><button data-action="save" class="primary">Save changes</button></div></footer></div></div>
    <dialog id="case-dialog" aria-labelledby="case-title"></dialog>`;
}
function empty(title, description, extra = '') {
  return `<section class="empty"><h2>${esc(title)}</h2><p>${esc(description)}</p>${extra}</section>`;
}
async function loadGuild(id) {
  requestController?.abort();
  requestController = new AbortController();
  const epoch = ++state.epoch;
  state.guildId = id; state.data = null; state.draft = null; state.dirty = false;
  $('#case-dialog')?.close();
  $('#savebar').hidden = true;
  $('#review-count').textContent = '0';
  $('#mode-badge').textContent = '';
  $('#connection').textContent = 'Checking connection';
  $('#guild-name').textContent = state.guilds.find(guild => guild.id === id)?.name ?? '';
  $('#main').innerHTML = '<div class="loading-page" aria-busy="true">Loading server…</div>';
  updateNav();
  const guild = state.guilds.find(item => item.id === id);
  if (!guild?.installed) {
    $('#connection').textContent = 'Bot not installed';
    $('#main').innerHTML = empty('Add Jev-Mod to this server', 'Install the bot, enable Message Content Intent, then refresh to configure moderation.',
      `<a class="button primary" href="${esc(guild?.inviteUrl ?? '/auth/login')}">Add to Discord</a> <button data-action="refresh-guilds">Refresh servers</button>`);
    return;
  }
  try {
    const data = await api(`/api/guilds/${id}`, { signal: requestController.signal });
    if (epoch !== state.epoch) return;
    state.data = data;
    state.draft = structuredClone(data.settings);
    render();
  } catch (error) {
    if (error.name === 'AbortError' || epoch !== state.epoch || !$('#main')) return;
    $('#main').innerHTML = empty('Server could not load', error.message, '<button data-action="refresh">Try again</button>');
  }
}
function updateNav() {
  for (const button of document.querySelectorAll('[data-view]')) {
    button.classList.toggle('active', button.dataset.view === state.view);
    if (button.dataset.view === state.view) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
  $('#page-name').textContent = { rules: 'Auto moderation', activity: 'Activity', settings: 'Server settings' }[state.view];
}
function render() {
  updateNav();
  if (!state.data) return;
  const { settings, health, stats } = state.data;
  const modeNames = { monitor: 'Monitoring', protect: 'Protection enabled', off: 'Moderation paused' };
  $('#mode-badge').innerHTML = `<span class="badge ${esc(settings.mode)}"><span class="dot ${settings.mode === 'protect' ? 'on' : ''}"></span>${modeNames[settings.mode]}</span>`;
  $('#connection').innerHTML = `<span class="dot ${health.connected ? 'on' : ''}"></span>${state.session.demo ? 'Preview · not connected' : health.connected ? 'Discord connected' : 'Discord reconnecting'}`;
  $('#review-count').textContent = stats.review;
  $('#main').innerHTML = ({ rules: renderRules, activity: renderActivity, settings: renderSettings }[state.view])();
  $('#savebar').hidden = !state.dirty;
}
const actionSelect = (value, attributes) => `<select ${attributes}>${Object.entries(actions).map(([key, label]) => `<option value="${key}" ${value === key ? 'selected' : ''}>${label}</option>`).join('')}</select>`;
function renderRules() {
  const settings = state.draft;
  return `<div class="page-title"><div><div class="eyebrow">Protection that understands context</div><h1>Auto moderation</h1><p>Decide what belongs in your server. Jev checks the meaning of each message against your rules.</p></div></div>
    <div class="notice-panel"><span class="status-symbol" aria-hidden="true">◉</span><div><h3>${settings.mode === 'monitor' ? 'Watch first. Act when you are ready.' : settings.mode === 'protect' ? 'Matching messages can be removed.' : 'Moderation is paused.'}</h3><p>Monitoring records matches. Protection applies each rule’s action. Jev checks messages after they are posted.</p></div>
      <select data-setting="mode" aria-label="Moderation mode"><option value="monitor" ${settings.mode === 'monitor' ? 'selected' : ''}>Monitor only</option><option value="protect" ${settings.mode === 'protect' ? 'selected' : ''}>Protect server</option><option value="off" ${settings.mode === 'off' ? 'selected' : ''}>Paused</option></select></div>
    ${state.data.health.lastIssue ? `<div class="notice-panel"><div><h3>Recent moderation issue</h3><p>${esc(state.data.health.lastIssue.event.replaceAll('_', ' '))} · ${esc(date(state.data.health.lastIssue.at))}. Check service logs before relying on enforcement.</p></div></div>` : ''}
    <div class="rules-layout"><section><div class="section-heading"><h2>Message rules</h2><span>${settings.rules.length} categories · Jev</span></div><div class="rules">
    ${settings.rules.map(rule => {
      const info = state.session.catalog.find(item => item.id === rule.id);
      return `<article class="rule"><div class="rule-top"><label class="rule-title"><input type="checkbox" data-rule="${rule.id}" data-field="enabled" ${rule.enabled ? 'checked' : ''}>${esc(info.name)}</label><span class="badge">Meaning-based</span></div><p>${esc(info.description)}</p>
      <div class="rule-controls"><label><span class="field-label">Match threshold <output id="threshold-${rule.id}">${percent(rule.threshold)}</output></span><input type="range" min="50" max="100" step="1" value="${Math.round(rule.threshold * 100)}" data-rule="${rule.id}" data-field="threshold" aria-label="${esc(info.name)} match threshold"></label>
      <label><span class="field-label">When matched</span>${actionSelect(rule.action, `data-rule="${rule.id}" data-field="action" aria-label="${esc(info.name)} action"`)}</label></div>
      <details><summary>Edit detection instructions</summary><label>Define the behavior this rule should catch.<textarea maxlength="1000" minlength="10" data-rule="${rule.id}" data-field="instructions">${esc(rule.instructions)}</textarea></label></details></article>`;
    }).join('')}</div><p class="local-summary">Also check blocked phrases and excessive mentions. <button data-view="settings">Configure local filters</button></p></section>
    <aside class="tester"><div class="eyebrow">Before it goes live</div><h2>Try a message</h2><p>See how your saved rules respond. Nothing is posted, deleted, or sent to Discord.</p>
      <form id="test-form"><label for="test-message">MESSAGE TEXT</label><textarea id="test-message" name="content" required maxlength="4000" placeholder="Paste a message to check…"></textarea><button class="primary" type="submit">Test saved rules <span aria-hidden="true">↗</span></button></form>
      <div id="test-result" aria-live="polite"></div><div class="tester-foot">${state.session.demo ? 'Preview has no Jev connection. Sample cases appear in Activity.' : 'Test text is sent to TypeSafe. Channel and role exceptions do not apply to this test.'}<br><br>Thresholds are probabilities of a rule match. Higher thresholds act on fewer messages.</div></aside></div>
    <p class="page-foot">Text only · Bot messages and direct messages are excluded · Failed or uncertain evaluations never trigger punishment</p>`;
}
function renderActivity() {
  const { stats, cases } = state.data;
  const rows = state.filter === 'review' ? cases.filter(reviewable) : cases;
  return `<div class="page-title"><div><div class="eyebrow">Every decision, accounted for</div><h1>Moderation activity</h1><p>Review flagged messages and see what Jev-Mod did. Evidence is retained for 30 days.</p></div><button data-action="refresh">Refresh</button></div>
    <div class="stats-line"><div><strong>${esc(stats.total)}</strong><span>Recorded cases · 30 days</span></div><div><strong>${esc(stats.review)}</strong><span>Open for review</span></div><div><strong>${esc(stats.removed)}</strong><span>Messages removed</span></div></div>
    <div class="activity-toolbar"><h2>Recent cases</h2><label>Show <select id="activity-filter"><option value="all" ${state.filter === 'all' ? 'selected' : ''}>All cases</option><option value="review" ${state.filter === 'review' ? 'selected' : ''}>Needs review</option></select></label></div>
    ${rows.length ? `<div class="table-wrap"><table><thead><tr><th scope="col">Message / rule</th><th scope="col">Match</th><th scope="col">Outcome</th><th scope="col">Time</th></tr></thead><tbody>${rows.map(item => `<tr><td><button class="case-button" data-case="${esc(item.id)}">${esc(item.matches.map(match => match.name).join(', '))}<span class="muted"> · #${esc(item.id)}</span></button><p class="case-excerpt">${esc(item.content)}</p></td><td class="mono">${percent(Math.max(...item.matches.map(match => match.probability), 0))}</td><td><span class="badge ${esc(item.outcome.includes('failed') ? 'failed' : item.outcome)}">${esc(outcomes[item.outcome] ?? item.outcome)}</span></td><td class="muted">${esc(date(item.created_at))}</td></tr>`).join('')}</tbody></table></div>` : empty('No cases here', state.filter === 'review' ? 'No cases on this page need review.' : 'Matches will appear here when Jev-Mod observes unwanted messages.')}
    ${cases.length >= 50 ? '<button class="quiet" data-action="more" style="margin-top:16px">Load older cases</button>' : ''}
    <p class="page-foot">${state.session.demo ? 'All messages and probabilities on this page are sample data, not Jev results.' : 'Allowed message text is not stored. Action failures remain visible in the case record.'}</p>`;
}
function checkList(name, items, selected, prefix = '') {
  return `<div class="check-list">${items.length ? items.map(item => `<label><input type="checkbox" data-list="${name}" value="${esc(item.id)}" ${selected.includes(item.id) ? 'checked' : ''}>${prefix}${esc(item.name)}</label>`).join('') : '<span class="muted small">No options available.</span>'}</div>`;
}
function renderSettings() {
  const settings = state.draft;
  const { metadata, audit } = state.data;
  return `<div class="page-title"><div><div class="eyebrow">A policy for this community</div><h1>Server settings</h1><p>Choose where rules apply, configure local filters, and set your moderation log.</p></div></div>
    <div class="settings-grid"><section class="settings-section"><h2>Exceptions</h2><p>Messages in these channels or from these roles bypass all automatic rules. A channel exception also covers its threads.</p>
      <fieldset><legend>Exempt channels</legend>${checkList('exemptChannels', metadata.channels, settings.exemptChannels, '# ')}</fieldset>
      <fieldset class="field"><legend>Exempt roles</legend>${checkList('exemptRoles', metadata.roles, settings.exemptRoles)}</fieldset></section>
    <section class="settings-section"><h2>Local filters</h2><p>These checks use simple rules. They do not require a model decision, but no punishment runs if Jev evaluation fails.</p>
      <div class="field"><label for="phrases">Blocked phrases · one per line</label><textarea id="phrases" data-setting="blockedPhrases" placeholder="Add phrases your server does not allow">${esc(settings.blockedPhrases.join('\n'))}</textarea><span class="muted small">Case-insensitive substring matches. Up to 100 phrases, 2–100 characters each.</span></div>
      <div class="field"><label for="mentions">Mention limit per message</label><input id="mentions" type="number" min="0" max="50" value="${settings.mentionLimit}" data-setting="mentionLimit"><span class="muted small"> 0 disables this check.</span></div>
      <div class="field"><label for="local-action">Action for local filters</label>${actionSelect(settings.localAction, 'id="local-action" data-setting="localAction"')}</div></section>
    <section class="settings-section"><h2>Actions & logs</h2><p>Permissions are checked again when an action runs. Timeouts also follow Discord’s role hierarchy.</p>
      <div class="field"><label for="timeout">Timeout duration · minutes</label><input id="timeout" type="number" min="1" max="40320" value="${settings.timeoutMinutes}" data-setting="timeoutMinutes"></div>
      <div class="field"><label for="log-channel">Moderator log channel</label><select id="log-channel" data-setting="logChannelId"><option value="">Dashboard only</option>${metadata.channels.map(channel => `<option value="${esc(channel.id)}" ${settings.logChannelId === channel.id ? 'selected' : ''}># ${esc(channel.name)}</option>`).join('')}</select></div>
      <div class="field small secondary">Bot permissions: ${metadata.permissions.manageMessages ? 'Manage Messages available' : '<span class="error">Manage Messages missing</span>'} · ${metadata.permissions.moderateMembers ? 'Timeout available' : '<span class="error">Timeout permission missing</span>'}</div></section>
    <section class="settings-section"><h2>Settings history</h2><p>Changes are tied to the moderator who saved them.</p><ul class="audit">${audit.length ? audit.map(item => `<li>${esc(item.event)}<span>${esc(date(item.created_at))} · <span class="mono">${esc(item.actor_id)}</span></span></li>`).join('') : '<li class="muted">No saved changes yet.</li>'}</ul>
    <div class="field small muted">Flagged messages and settings history are retained for 30 days. Removing the bot removes server records.</div></section></div>`;
}
function markDirty() {
  state.dirty = JSON.stringify(state.draft) !== JSON.stringify(state.data.settings);
  $('#savebar').hidden = !state.dirty;
}
function showCase(id) {
  const item = state.data.cases.find(row => String(row.id) === id);
  if (!item) return;
  const dialog = $('#case-dialog');
  dialog.innerHTML = `<div class="dialog-header"><div><div class="eyebrow">Moderation record</div><h2 id="case-title">Case #${esc(item.id)}</h2></div><button data-action="close-case" class="quiet" aria-label="Close case">✕</button></div><div class="dialog-body">
    <span class="badge ${esc(item.outcome)}">${esc(outcomes[item.outcome] ?? item.outcome)}</span><pre>${esc(item.content)}</pre>
    <dl class="dialog-meta"><dt>Matched rules</dt><dd>${esc(item.matches.map(match => `${match.name} (${percent(match.probability)})`).join(', '))}</dd><dt>Requested action</dt><dd>${esc(actions[item.requested_action])}</dd><dt>Model</dt><dd class="mono">${esc(item.model ?? 'Local rules')}</dd><dt>Member</dt><dd class="mono">${esc(item.author_id)}</dd><dt>Channel</dt><dd class="mono">${esc(item.channel_id)}</dd><dt>Time</dt><dd>${esc(date(item.created_at))}</dd><dt>Reviewed by</dt><dd class="mono">${esc(item.reviewed_by ?? 'Not reviewed')}</dd></dl></div>
    <div class="dialog-footer">${reviewable(item) ? `<button data-review="dismiss" data-id="${esc(item.id)}">Dismiss case</button><button class="danger" data-review="delete" data-id="${esc(item.id)}" ${state.session.demo ? 'disabled title="Discord actions are disabled in preview"' : ''}>Delete message</button>` : '<button data-action="close-case">Close</button>'}</div>`;
  dialog.showModal();
}
let lockedControls = [];
function setBusy(value) {
  state.busy = value;
  if (value) {
    lockedControls = [...document.querySelectorAll('#app button, #app input, #app select, #app textarea')].map(node => [node, node.disabled]);
    for (const [node] of lockedControls) node.disabled = true;
  } else {
    for (const [node, disabled] of lockedControls) if (node.isConnected) node.disabled = disabled;
    lockedControls = [];
  }
}
async function mutate(callback) {
  if (state.busy) return;
  setBusy(true);
  try { await callback(); } catch (error) { notice(error.message, true); }
  finally { setBusy(false); }
}
$('#app').addEventListener('input', event => {
  const target = event.target;
  if (!state.draft) return;
  if (target.dataset.rule) {
    const rule = state.draft.rules.find(item => item.id === target.dataset.rule);
    const field = target.dataset.field;
    rule[field] = field === 'enabled' ? target.checked : field === 'threshold' ? Number(target.value) / 100 : target.value;
    if (field === 'threshold') $(`#threshold-${rule.id}`).textContent = percent(rule.threshold);
  } else if (target.dataset.setting) {
    const key = target.dataset.setting;
    state.draft[key] = key === 'blockedPhrases' ? target.value.split('\n').map(value => value.trim()).filter(Boolean)
      : ['mentionLimit', 'timeoutMinutes'].includes(key) ? Number(target.value) : target.value;
  } else if (target.dataset.list) {
    const key = target.dataset.list;
    state.draft[key] = target.checked ? [...state.draft[key], target.value] : state.draft[key].filter(value => value !== target.value);
  } else return;
  markDirty();
});
$('#app').addEventListener('change', event => {
  if (event.target.id === 'server') {
    if (state.dirty && !confirm('Discard unsaved changes and switch servers?')) { event.target.value = state.guildId; return; }
    loadGuild(event.target.value);
  } else if (event.target.id === 'activity-filter') { state.filter = event.target.value; render(); }
});
$('#app').addEventListener('click', async event => {
  const target = event.target.closest('button');
  if (!target) return;
  if (target.dataset.view) { state.view = target.dataset.view; render(); return; }
  if (target.dataset.case) { showCase(target.dataset.case); return; }
  if (target.dataset.review) {
    if (target.dataset.review === 'delete' && !confirm('Permanently delete this Discord message? This cannot be undone.')) return;
    await mutate(async () => {
      const result = await api(`/api/guilds/${state.guildId}/cases/${target.dataset.id}/review`, { method: 'POST', body: JSON.stringify({ action: target.dataset.review }) });
      $('#case-dialog').close(); notice(outcomes[result.outcome] ?? result.outcome); await loadGuild(state.guildId);
    });
    return;
  }
  const action = target.dataset.action;
  if (action === 'close-case') $('#case-dialog').close();
  if (action === 'discard') { state.draft = structuredClone(state.data.settings); state.dirty = false; render(); }
  if (action === 'save') await mutate(async () => {
    const result = await api(`/api/guilds/${state.guildId}/settings`, { method: 'PUT', body: JSON.stringify({ version: state.data.version, settings: state.draft }) });
    state.data.settings = result.settings; state.data.version = result.version; state.dirty = false;
    notice(state.session.demo ? 'Preview settings saved for this session.' : 'Server settings saved.');
    await loadGuild(state.guildId);
  });
  if (action === 'refresh') {
    if (!state.dirty || confirm('Discard unsaved changes and refresh?')) await loadGuild(state.guildId);
  }
  if (action === 'refresh-guilds') location.reload();
  if (action === 'logout') await mutate(async () => { await api('/api/logout', { method: 'POST' }); location.reload(); });
  if (action === 'more') {
    const epoch = state.epoch;
    try {
      const cases = state.data.cases;
      const older = await api(`/api/guilds/${state.guildId}/cases?before=${cases.at(-1).id}`);
      if (epoch !== state.epoch) return;
      state.data.cases.push(...older); render();
      if (!older.length) notice('No older cases.');
    } catch (error) { notice(error.message, true); }
  }
});
$('#app').addEventListener('submit', async event => {
  if (event.target.id !== 'test-form') return;
  event.preventDefault();
  const epoch = state.epoch;
  const button = event.target.querySelector('button');
  button.disabled = true; button.textContent = 'Checking…';
  try {
    const result = await api(`/api/guilds/${state.guildId}/test`, { method: 'POST', body: JSON.stringify({ content: new FormData(event.target).get('content') }), signal: requestController.signal });
    if (epoch !== state.epoch || !$('#test-result')) return;
    $('#test-result').innerHTML = `<div class="test-result"><h3>${esc(({ allow: 'Allow message', monitor: 'Record for review', ...actions })[result.action])}</h3><p class="muted small">Saved rules · ${esc(result.model ?? 'Local checks')}</p>${result.scores.map(score => `<div class="score-row"><span>${esc(score.name)}</span><span>${percent(score.probability)}</span></div><progress class="score-track" max="1" value="${score.probability}" aria-label="${esc(score.name)} match probability"></progress>`).join('')}</div>`;
  } catch (error) {
    if (error.name !== 'AbortError' && epoch === state.epoch && $('#test-result')) $('#test-result').innerHTML = `<div class="test-result error small">${esc(error.message)}</div>`;
  } finally { button.disabled = false; button.textContent = 'Test saved rules ↗'; }
});
window.addEventListener('beforeunload', event => { if (state.dirty) { event.preventDefault(); event.returnValue = ''; } });

try {
  state.session = await api('/api/session');
  if (!state.session.user) login();
  else {
    state.guilds = await api('/api/guilds');
    shell();
    if (state.guilds.length) { state.guildId = state.guilds[0].id; await loadGuild(state.guildId); }
    else $('#main').innerHTML = empty('No servers to manage', 'Sign in with an account that has Manage Server permission, or add Jev-Mod to a server.', state.session.inviteUrl ? `<a class="button primary" href="${esc(state.session.inviteUrl)}">Add to Discord</a>` : '');
  }
} catch (error) { login(error.message); }
