import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { Settings as Policy } from '@jev-mod/core/policy.ts';
import type { DashboardData } from '@jev-mod/core/types.ts';
import { ActionSelect, TimeoutDuration } from './rules';
import { api, date } from './api';
import { HelpTip } from './help-tip';

function Exceptions({ legend, help, items, value, onChange }: { legend: string; help?: ReactNode; items: { id: string; name: string }[]; value: string[]; onChange(value: string[]): void }) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const names = new Map(items.map(item => [item.id, item.name]));
  const matches = items.filter(item => `${item.name} ${item.id}`.toLocaleLowerCase().includes(search.toLocaleLowerCase().trim()));
  const pages = Math.max(1, Math.ceil(matches.length / 40));
  const currentPage = Math.min(page, pages - 1);
  return <fieldset className="exceptions"><legend>{legend} <span className="muted">{value.length}/100 selected</span>{help}</legend>
    {value.length > 0 && <ul className="selected-options" aria-label={`Selected ${legend.toLowerCase()}`}>{value.map(id => <li key={id}><span>{names.get(id) ?? `Unavailable · ${id}`}</span><button type="button" className="btn btn-ghost btn-xs" aria-label={`Remove ${names.get(id) ?? id}`} onClick={() => onChange(value.filter(selected => selected !== id))}>Remove</button></li>)}</ul>}
    <label className="field">Search {legend.toLowerCase()}<input className="input" type="search" value={search} placeholder="Name or ID" onChange={event => { setSearch(event.target.value); setPage(0); }} /></label>
    <div className="check-list">{matches.slice(currentPage * 40, (currentPage + 1) * 40).map(item => <label key={item.id}><input className="checkbox checkbox-sm checkbox-primary" type="checkbox" checked={value.includes(item.id)} disabled={value.length >= 100 && !value.includes(item.id)} onChange={event => onChange(event.target.checked ? [...value, item.id] : value.filter(id => id !== item.id))} /><span>{item.name}<small>{item.id}</small></span></label>)}{!matches.length && <p>No matching options.</p>}</div>
    <div className="list-pagination"><span>{matches.length} matches · Page {currentPage + 1} of {pages}</span><button className="btn btn-ghost btn-xs" type="button" aria-label={`Previous ${legend.toLowerCase()}`} disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button><button className="btn btn-ghost btn-xs" type="button" aria-label={`Next ${legend.toLowerCase()}`} disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>Next</button></div>
  </fieldset>;
}
function Phrases({ value, onChange }: { value: string[]; onChange(value: string[]): void }) {
  const [phrase, setPhrase] = useState('');
  const [error, setError] = useState('');
  function add() {
    const next = phrase.trim();
    if (next.length < 2 || next.length > 100) { setError('Use 2–100 characters.'); return; }
    if (value.length >= 100) { setError('Use at most 100 phrases.'); return; }
    if (value.some(item => item.normalize('NFKC').toLocaleLowerCase('en-US') === next.normalize('NFKC').toLocaleLowerCase('en-US'))) { setError('This phrase is already blocked.'); return; }
    onChange([...value, next]); setPhrase(''); setError('');
  }
  return <fieldset><legend className="label-with-help">Blocked phrases · {value.length}/100<HelpTip label="Phrase matching">Matches any part of a message, ignoring letter case. Use 2–100 characters per phrase.</HelpTip></legend><div className="phrase-entry"><label className="field">Add phrase<input className="input" value={phrase} maxLength={100} onChange={event => { setPhrase(event.target.value); setError(''); }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); add(); } }} /></label><button className="btn" type="button" disabled={!phrase.trim() || value.length >= 100} onClick={add}>Add phrase</button></div>
    {error && <p className="error" role="alert">{error}</p>}<ul className="selected-options" aria-label="Blocked phrases">{value.map((item, index) => <li key={`${index}-${item}`}><span>{item}</span><button className="btn btn-ghost btn-xs" type="button" aria-label={`Remove phrase ${item}`} onClick={() => onChange(value.filter((_, position) => position !== index))}>Remove</button></li>)}</ul></fieldset>;
}
function ApiKey({ guildId, status, disabled, demo, onStatus }: { guildId: string; status: DashboardData['keyStatus']; disabled: boolean; demo: boolean; onStatus(status: DashboardData['keyStatus']): void }) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => { setKey(''); setMessage(''); setError(''); setBusy(false); return () => controller.current?.abort(); }, [guildId]);
  async function save(remove: boolean) {
    controller.current?.abort();
    const current = new AbortController(); controller.current = current;
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await api<DashboardData['keyStatus']>(`/api/guilds/${guildId}/key`, { method: remove ? 'DELETE' : 'PUT', body: JSON.stringify(remove ? {} : { key: key.trim() }), signal: current.signal });
      if (current.signal.aborted) return;
      setKey(''); onStatus(result); setMessage(remove ? 'Server API key removed.' : 'Server API key saved.');
    } catch (error) { if (!current.signal.aborted) setError((error as Error).message); }
    finally { if (!current.signal.aborted) setBusy(false); }
  }
  return <><h2 className="label-with-help">TypeSafe API key<HelpTip label="Key storage and data sharing">Keys are encrypted and never shown again. Jev sends message text to TypeSafe. Removing a server key uses the operator key when available.</HelpTip></h2><p className="key-status" role="status">{({ server: 'Server key configured', operator: 'Using operator key', missing: 'Add a key to enable Jev rules.' })[status.source]}</p>
    <fieldset disabled={disabled || busy || demo}><label className="field">{status.source === 'server' ? 'Replace server key' : 'Server API key'}<input className="input" type="password" autoComplete="new-password" spellCheck={false} value={key} onChange={event => setKey(event.target.value)} /></label><div className="key-actions"><button className="btn btn-primary" disabled={!key.trim()} onClick={() => save(false)}>{busy ? 'Updating…' : 'Save API key'}</button>{status.source === 'server' && <button className="btn btn-ghost" onClick={() => save(true)}>Remove API key</button>}</div></fieldset>
    {error && <p className="error" role="alert">{error}</p>}{message && <p role="status">{message}</p>}</>;
}
const tabs = ['Exceptions', 'Content filters', 'Actions/logs', 'API key', 'History'];
export function Settings({ data, draft, update, disabled, guildId, keyStatusChanged }: { data: DashboardData; draft: Policy; update(value: Policy): void; disabled: boolean; guildId: string; keyStatusChanged(status: DashboardData['keyStatus']): void }) {
  const [tab, setTab] = useState(0);
  const id = useId();
  const logChannels = data.metadata.channels.filter(channel => channel.sendable);
  return <><header className="page-title"><h1>Server settings</h1></header>
    <div className="tabs settings-tabs" role="tablist" aria-label="Server settings">{tabs.map((name, index) => <button className={`tab ${tab === index ? 'tab-active' : ''}`} key={name} role="tab" id={`${id}-tab-${index}`} aria-controls={`${id}-panel-${index}`} aria-selected={tab === index} tabIndex={tab === index ? 0 : -1} onClick={() => setTab(index)} onKeyDown={event => {
      const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : undefined;
      if (next !== undefined) { event.preventDefault(); setTab(next); document.getElementById(`${id}-tab-${next}`)?.focus(); }
    }}>{name}</button>)}</div>
    <section className="settings-card card" role="tabpanel" id={`${id}-panel-${tab}`} aria-labelledby={`${id}-tab-${tab}`} tabIndex={0}>
      {tab === 0 && <fieldset disabled={disabled}><Exceptions legend="Exempt channels" help={<HelpTip label="How exceptions work">Selected roles and channels bypass automatic rules. Channel exceptions include their threads.</HelpTip>} items={data.metadata.channels.map(channel => ({ ...channel, name: `# ${channel.name}` }))} value={draft.exemptChannels} onChange={exemptChannels => update({ ...draft, exemptChannels })} /><Exceptions legend="Exempt roles" items={data.metadata.roles} value={draft.exemptRoles} onChange={exemptRoles => update({ ...draft, exemptRoles })} /></fieldset>}
      {tab === 1 && <fieldset disabled={disabled}><Phrases value={draft.blockedPhrases} onChange={blockedPhrases => update({ ...draft, blockedPhrases })} /><label className="toggle-field"><input className="toggle toggle-sm toggle-primary" type="checkbox" checked={draft.mentionLimit > 0} onChange={event => update({ ...draft, mentionLimit: event.target.checked ? 8 : 0 })} />Limit mentions</label>{draft.mentionLimit > 0 && <label className="field">Act at this many mentions<input className="input input-sm number" type="number" min={1} max={50} value={draft.mentionLimit} onChange={event => update({ ...draft, mentionLimit: Math.max(1, Number(event.target.value)) })} /></label>}
        <label className="field">Action for content filters<ActionSelect label="Action for content filters" value={draft.localAction} onChange={localAction => update({ ...draft, localAction })} /></label>{draft.localAction === 'timeout' && <TimeoutDuration value={draft.timeoutMinutes} onChange={timeoutMinutes => update({ ...draft, timeoutMinutes })} />}</fieldset>}
      {tab === 2 && <fieldset disabled={disabled}><TimeoutDuration value={draft.timeoutMinutes} onChange={timeoutMinutes => update({ ...draft, timeoutMinutes })} /><label className="field">Moderator log channel<select className="select" value={draft.logChannelId} onChange={event => update({ ...draft, logChannelId: event.target.value })}><option value="">Dashboard only</option>{draft.logChannelId && !logChannels.some(channel => channel.id === draft.logChannelId) && <option value={draft.logChannelId} disabled>Unavailable · {draft.logChannelId}</option>}{logChannels.map(channel => <option key={channel.id} value={channel.id}># {channel.name}</option>)}</select></label><p className="fine permission-status">Manage Messages: {data.metadata.permissions.manageMessages ? 'Available' : 'Missing'} · Timeout: {data.metadata.permissions.moderateMembers ? 'Available' : 'Missing'}</p></fieldset>}
      {tab === 3 && <ApiKey guildId={guildId} status={data.keyStatus} disabled={disabled} demo={data.demo} onStatus={keyStatusChanged} />}
      {tab === 4 && <ul className="audit">{data.audit.map(item => <li key={item.id}>{item.event}<span>{date(item.created_at)} · <code>{item.actor_id}</code></span></li>)}{!data.audit.length && <li>No saved changes yet.</li>}</ul>}
    </section></>;
}
