import type { Settings as Policy } from '@jev-mod/core/policy.ts';
import type { DashboardData } from '@jev-mod/core/types.ts';
import { ActionSelect } from './rules';
import { date } from './api';

function Exceptions({ legend, items, value, onChange }: { legend: string; items: { id: string; name: string }[]; value: string[]; onChange(value: string[]): void }) {
  const options = [...items, ...value.filter(id => !items.some(item => item.id === id)).map(id => ({ id, name: `Unavailable · ${id}` }))];
  return <fieldset><legend>{legend}</legend><div className="check-list">{options.map(item => <label key={item.id}><input className="checkbox checkbox-sm checkbox-primary" type="checkbox" checked={value.includes(item.id)} onChange={event => onChange(event.target.checked ? [...value, item.id] : value.filter(id => id !== item.id))} />{item.name}</label>)}{!options.length && <p>No options available.</p>}</div></fieldset>;
}
export function Settings({ data, draft, update, disabled }: { data: DashboardData; draft: Policy; update(value: Policy): void; disabled: boolean }) {
  const logChannels = data.metadata.channels.filter(channel => channel.sendable);
  return <><header className="page-title"><div className="eyebrow">A policy for this community</div><h1>Server settings</h1><p>Choose where rules apply, configure local filters, and set your moderation log.</p></header>
    <fieldset disabled={disabled} className="settings-grid"><section className="settings-card card"><h2>Exceptions</h2><p>These channels and roles bypass all automatic rules. Channel exceptions also cover their threads.</p>
      <Exceptions legend="Exempt channels" items={data.metadata.channels.map(channel => ({ ...channel, name: `# ${channel.name}` }))} value={draft.exemptChannels} onChange={exemptChannels => update({ ...draft, exemptChannels })} />
      <Exceptions legend="Exempt roles" items={data.metadata.roles} value={draft.exemptRoles} onChange={exemptRoles => update({ ...draft, exemptRoles })} /></section>
      <section className="settings-card card"><h2>Local filters</h2><p>Simple text and mention checks. If the Jev evaluation fails, no automatic punishment runs.</p>
        <label className="field">Blocked phrases · one per line<textarea className="textarea" value={draft.blockedPhrases.join('\n')} onChange={event => update({ ...draft, blockedPhrases: event.target.value.split('\n') })} /><small>Up to 100 phrases, 2–100 characters each. Case-insensitive substring matching.</small></label>
        <label className="field">Mention limit per message<input className="input input-sm number" type="number" min={0} max={50} value={draft.mentionLimit} onChange={event => update({ ...draft, mentionLimit: Number(event.target.value) })} /><small>0 disables this check.</small></label>
        <label className="field">Action for local filters<ActionSelect label="Action for local filters" value={draft.localAction} onChange={localAction => update({ ...draft, localAction })} /></label></section>
      <section className="settings-card card"><h2>Actions & logs</h2><p>Permissions are checked for each action. Timeouts follow Discord’s role hierarchy.</p>
        <label className="field">Timeout duration · minutes<input className="input input-sm number" type="number" min={1} max={40320} value={draft.timeoutMinutes} onChange={event => update({ ...draft, timeoutMinutes: Number(event.target.value) })} /></label>
        <label className="field">Moderator log channel<select className="select" value={draft.logChannelId} onChange={event => update({ ...draft, logChannelId: event.target.value })}><option value="">Dashboard only</option>{draft.logChannelId && !logChannels.some(channel => channel.id === draft.logChannelId) && <option value={draft.logChannelId} disabled>Unavailable · {draft.logChannelId}</option>}{logChannels.map(channel => <option key={channel.id} value={channel.id}># {channel.name}</option>)}</select></label>
        <p className="fine">Manage Messages: {data.metadata.permissions.manageMessages ? 'Available' : 'Missing'} · Timeout: {data.metadata.permissions.moderateMembers ? 'Available' : 'Missing'}</p></section>
      <section className="settings-card card"><h2>Settings history</h2><p>Changes are tied to the moderator who saved them.</p><ul className="audit">{data.audit.map(item => <li key={item.id}>{item.event}<span>{date(item.created_at)} · <code>{item.actor_id}</code></span></li>)}{!data.audit.length && <li>No saved changes yet.</li>}</ul>
        <p className="fine">Flagged evidence and history are retained for 30 days. Removing the bot removes server records.</p></section></fieldset></>;
}
