import { useState } from 'react';
import { ArrowUpRight, Radio } from 'lucide-react';
import { catalog, type Settings } from '@jev-mod/core/policy.ts';
import type { Decision } from '@jev-mod/core/types.ts';
import { api, actionLabels, percentage } from './api';

export function ActionSelect({ value, onChange, label }: { value: Settings['localAction']; onChange(value: Settings['localAction']): void; label: string }) {
  return <select className="select select-sm" aria-label={label} value={value} onChange={event => onChange(event.target.value as Settings['localAction'])}>
    {Object.entries(actionLabels).map(([key, name]) => <option value={key} key={key}>{name}</option>)}
  </select>;
}
export function Rules({ draft, update, guildId, demo, disabled }: {
  draft: Settings; update(value: Settings): void; guildId: string; demo: boolean; disabled: boolean;
}) {
  return <><header className="page-title"><div className="eyebrow">Protection that understands context</div><h1>Auto moderation</h1><p>Decide what belongs in your server. Jev checks the meaning of each message against your rules.</p></header>
    <section className="mode-panel"><Radio size={17} aria-hidden="true" /><div><h2>{draft.mode === 'monitor' ? 'Watch first. Act when you are ready.' : draft.mode === 'protect' ? 'Matching messages can be removed.' : 'Moderation is paused.'}</h2>
      <p>Monitoring records matches. Protection applies each rule’s action. Jev checks messages after they are posted.</p></div>
      <select className="select select-sm" aria-label="Moderation mode" disabled={disabled} value={draft.mode} onChange={event => update({ ...draft, mode: event.target.value as Settings['mode'] })}>
        <option value="monitor">Monitor only</option><option value="protect">Protect server</option><option value="off">Paused</option></select></section>
    <div className="rules-layout"><section><div className="section-heading"><h2>Message rules</h2><span>6 categories · Jev</span></div>
      <fieldset disabled={disabled} className="rule-list">{draft.rules.map((rule, index) => {
        const info = catalog.find(item => item.id === rule.id)!;
        const change = (patch: Partial<typeof rule>) => update({ ...draft, rules: draft.rules.map((item, i) => i === index ? { ...item, ...patch } : item) });
        return <article className="rule" key={rule.id}><div className="rule-heading"><label><input className="toggle toggle-xs toggle-primary" type="checkbox" checked={rule.enabled} onChange={event => change({ enabled: event.target.checked })} />{info.name}</label><span className="badge badge-outline badge-sm">Meaning-based</span></div>
          <p>{info.description}</p><div className="rule-controls"><label><span>Match threshold <output>{percentage(rule.threshold)}</output></span><input className="range range-xs range-primary" aria-label={`${info.name} match threshold`} type="range" min="50" max="100" step="1" value={rule.threshold * 100} onChange={event => change({ threshold: Number(event.target.value) / 100 })} /></label>
            <label><span>When matched</span><ActionSelect label={`${info.name} action`} value={rule.action} onChange={action => change({ action })} /></label></div>
          <details><summary>Edit detection instructions</summary><label>Define what this rule should catch.<textarea className="textarea" minLength={10} maxLength={1000} value={rule.instructions} onChange={event => change({ instructions: event.target.value })} /></label></details></article>;
      })}</fieldset><p className="fine section-foot">Blocked phrases and mention limits are available in Server settings.</p></section>
      <Tester guildId={guildId} demo={demo} /></div><p className="fine section-foot">Text only · Bot messages and direct messages are excluded · Failed evaluations never trigger punishment</p></>;
}
function Tester({ guildId, demo }: { guildId: string; demo: boolean }) {
  const [content, setContent] = useState('');
  const [result, setResult] = useState<(Decision & { action: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return <aside className="tester card"><div className="eyebrow">Before it goes live</div><h2>Try a message</h2><p>See how your saved rules respond. Nothing is posted, deleted, or sent to Discord.</p>
    <form onSubmit={async event => {
      event.preventDefault(); setBusy(true); setError(''); setResult(null);
      try { setResult(await api(`/api/guilds/${guildId}/test`, { method: 'POST', body: JSON.stringify({ content }) })); }
      catch (error) { setError((error as Error).message); }
      finally { setBusy(false); }
    }}><label htmlFor="test-message">MESSAGE TEXT</label><textarea className="textarea" id="test-message" required maxLength={4000} placeholder="Paste a message to check…" value={content} onChange={event => setContent(event.target.value)} />
      <button className="btn btn-primary" disabled={busy}>{busy ? 'Checking…' : 'Test saved rules'}<ArrowUpRight size={15} aria-hidden="true" /></button></form>
    <div aria-live="polite">{error && <p className="error test-result">{error}</p>}{result && <div className="test-result"><h3>{({ allow: 'Allow message', monitor: 'Record for review', ...actionLabels })[result.action as keyof typeof actionLabels] ?? result.action}</h3>
      <p className="fine">Saved rules · {result.model ?? 'Local checks'}</p>{result.scores.map(score => <div key={score.id}><div className="score"><span>{score.name}</span><span>{percentage(score.probability)}</span></div><progress className="progress progress-primary" max={1} value={score.probability} aria-label={`${score.name} match probability`} /></div>)}</div>}</div>
    <div className="tester-foot">{demo ? 'Preview has no Jev connection. Sample cases appear in Activity.' : 'Test text is sent to TypeSafe. Channel and role exceptions do not apply to this test.'}<br /><br />Thresholds are probabilities of a rule match. Higher thresholds act on fewer messages.</div></aside>;
}
