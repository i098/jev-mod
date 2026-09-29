import { useState } from 'react';
import { ArrowUpRight, Radio } from 'lucide-react';
import { catalog, type Settings } from '@jev-mod/core/policy.ts';
import type { DashboardData, Decision } from '@jev-mod/core/types.ts';
import { api, actionLabels, percentage } from './api';
import { HelpTip } from './help-tip';

export function ActionSelect({ value, onChange, label }: { value: Settings['localAction']; onChange(value: Settings['localAction']): void; label: string }) {
  return <select className="select select-sm" aria-label={label} value={value} onChange={event => onChange(event.target.value as Settings['localAction'])}>
    {Object.entries(actionLabels).map(([key, name]) => <option value={key} key={key}>{name}</option>)}
  </select>;
}
export function TimeoutDuration({ value, onChange, label = 'Shared timeout duration · minutes' }: { value: number; onChange(value: number): void; label?: string }) {
  return <label className="field timeout-duration">{label}<input className="input input-sm number" type="number" min={1} max={40320} value={value} onChange={event => onChange(Number(event.target.value))} /><small>Applies to every Delete + timeout action.</small></label>;
}
export function Rules({ draft, update, guildId, demo, disabled, keyStatus }: {
  draft: Settings; update(value: Settings): void; guildId: string; demo: boolean; disabled: boolean; keyStatus: DashboardData['keyStatus'];
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [threshold, setThreshold] = useState('');
  const [action, setAction] = useState<Settings['localAction'] | ''>('');
  const thresholdValid = threshold === '' || (Number.isInteger(Number(threshold)) && Number(threshold) >= 50 && Number(threshold) <= 100);
  function clearSelection() { setSelected([]); setThreshold(''); setAction(''); }
  function applySelected() {
    if (disabled || !selected.length || !thresholdValid || (threshold === '' && !action)) return;
    update({ ...draft, rules: draft.rules.map(rule => selected.includes(rule.id) ? { ...rule,
      ...(threshold === '' ? {} : { threshold: Number(threshold) / 100 }), ...(action ? { action } : {}) } : rule) });
    setThreshold(''); setAction('');
  }
  return <><header className="page-title"><h1>Auto moderation</h1></header>
    <section className="mode-panel"><Radio size={17} aria-hidden="true" /><h2 className="label-with-help">Moderation mode<HelpTip label="Mode behavior">Monitor records matches. Protect applies actions after messages are posted. Paused disables automatic checks.</HelpTip></h2>
      <select className="select select-sm" aria-label="Moderation mode" disabled={disabled} value={draft.mode} onChange={event => update({ ...draft, mode: event.target.value as Settings['mode'] })}>
        <option value="monitor">Monitor only</option><option value="protect">Protect server</option><option value="off">Paused</option></select></section>
    <div className="rules-layout"><section><div className="section-heading"><h2>Message rules</h2><button className="btn btn-ghost btn-sm" disabled={disabled} onClick={() => selected.length === draft.rules.length ? clearSelection() : setSelected(draft.rules.map(rule => rule.id))}>{selected.length === draft.rules.length ? 'Clear selection' : 'Select all'}</button></div>
      {selected.length > 0 && <fieldset disabled={disabled} className="bulk-rules"><div className="bulk-heading"><strong>{selected.length} selected</strong><button className="btn btn-ghost btn-xs" onClick={clearSelection}>Cancel selection</button></div>
        <div className="bulk-controls"><label className="field">Threshold (%)<input className="input input-sm" type="number" min={50} max={100} step={1} placeholder="Keep current" value={threshold} aria-label="Selected rules threshold" aria-invalid={!thresholdValid} onChange={event => setThreshold(event.target.value)} /></label>
          <label className="field">When matched<select className="select select-sm" aria-label="Selected rules action" value={action} onChange={event => setAction(event.target.value as typeof action)}><option value="">Keep current</option>{Object.entries(actionLabels).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
          <button className="btn btn-primary btn-sm" disabled={!thresholdValid || (threshold === '' && !action)} onClick={applySelected}>Apply to selected</button></div>
        {!thresholdValid && <p role="alert" className="error">Enter a whole percentage from 50 to 100.</p>}
        {action === 'timeout' && <p className="fine">Shared timeout: {draft.timeoutMinutes} minutes. Edit it beside any timeout rule after applying.</p>}
      </fieldset>}
      <fieldset disabled={disabled} className="rule-list">{draft.rules.map((rule, index) => {
        const info = catalog.find(item => item.id === rule.id)!;
        const change = (patch: Partial<typeof rule>) => update({ ...draft, rules: draft.rules.map((item, i) => i === index ? { ...item, ...patch } : item) });
        return <article className="rule" key={rule.id}><div className="rule-heading"><label><input className="checkbox checkbox-sm checkbox-primary" type="checkbox" aria-label={`Select ${info.name}`} checked={selected.includes(rule.id)} onChange={event => event.target.checked ? setSelected([...selected, rule.id]) : selected.length === 1 ? clearSelection() : setSelected(selected.filter(id => id !== rule.id))} />{info.name}</label><input className="toggle toggle-xs toggle-primary" aria-label={`Enable ${info.name}`} type="checkbox" checked={rule.enabled} onChange={event => change({ enabled: event.target.checked })} /></div>
          <div className="rule-controls"><label><span title="Higher thresholds act on fewer messages.">Match threshold <output>{percentage(rule.threshold)}</output></span><input className="range range-xs range-primary" aria-label={`${info.name} match threshold`} aria-description="Higher thresholds act on fewer messages." type="range" min="50" max="100" step="1" value={rule.threshold * 100} onChange={event => change({ threshold: Number(event.target.value) / 100 })} /></label>
            <label><span>When matched</span><ActionSelect label={`${info.name} action`} value={rule.action} onChange={action => change({ action })} /></label></div>{rule.action === 'timeout' && <TimeoutDuration label={`${info.name} shared timeout · minutes`} value={draft.timeoutMinutes} onChange={timeoutMinutes => update({ ...draft, timeoutMinutes })} />}
          <details><summary>Edit detection instructions</summary><label>Detection instructions<textarea className="textarea" minLength={10} maxLength={1000} value={rule.instructions} onChange={event => change({ instructions: event.target.value })} /></label></details></article>;
      })}</fieldset></section>
      <Tester guildId={guildId} demo={demo} keyStatus={keyStatus} /></div></>;
}
function Tester({ guildId, demo, keyStatus }: { guildId: string; demo: boolean; keyStatus: DashboardData['keyStatus'] }) {
  const [content, setContent] = useState('');
  const [result, setResult] = useState<(Decision & { action: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return <aside className="tester card"><h2 className="label-with-help">Try a message<HelpTip label="Test behavior and data sharing">Uses saved rules without channel or role exceptions. No Discord action runs.{!demo && ' Enabled Jev rules send message text to TypeSafe.'}</HelpTip></h2>{!demo && keyStatus.source === 'missing' && <p role="status">Jev rules need a TypeSafe key. Add one under Server settings, API key.</p>}
    <form onSubmit={async event => {
      event.preventDefault(); setBusy(true); setError(''); setResult(null);
      try { setResult(await api(`/api/guilds/${guildId}/test`, { method: 'POST', body: JSON.stringify({ content }) })); }
      catch (error) { setError((error as Error).message); }
      finally { setBusy(false); }
    }}><label htmlFor="test-message">Message text</label><textarea className="textarea" id="test-message" required maxLength={4000} placeholder="Paste a message to check…" value={content} onChange={event => setContent(event.target.value)} />
      <button className="btn btn-primary" disabled={busy}>{busy ? 'Checking…' : 'Test saved rules'}<ArrowUpRight size={15} aria-hidden="true" /></button></form>
    <div aria-live="polite">{error && <p className="error test-result">{error}</p>}{result && <div className="test-result"><h3>{({ allow: 'Allow message', monitor: 'Record for review', ...actionLabels })[result.action as keyof typeof actionLabels] ?? result.action}</h3>
      <p className="fine">Saved rules · {result.model ?? 'Local checks'}</p>{result.scores.map(score => <div key={score.id}><div className="score"><span>{score.name}</span><span>{percentage(score.probability)}</span></div><progress className="progress progress-primary" max={1} value={score.probability} aria-label={`${score.name} match probability`} /></div>)}</div>}</div>
    </aside>;
}
