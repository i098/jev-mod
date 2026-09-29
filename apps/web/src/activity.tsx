import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { CaseRecord, DashboardData } from '@jev-mod/core/types.ts';
import { actionLabels, api, date, outcomeLabels, percentage, reviewable } from './api';

export function Activity({ data, refresh, guildId, notify }: { data: DashboardData; refresh(): Promise<void>; guildId: string; notify(message: string): void }) {
  const [filter, setFilter] = useState('all');
  const [older, setOlder] = useState<CaseRecord[]>([]);
  const [hasMore, setHasMore] = useState(data.cases.length === 50);
  const [selected, setSelected] = useState<CaseRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    setOlder([]); setHasMore(data.cases.length === 50); setBusy(false);
    return () => controller.current?.abort();
  }, [data, guildId]);
  const cases = [...data.cases, ...older];
  const rows = filter === 'review' ? cases.filter(reviewable) : cases;
  return <><header className="page-title"><div className="eyebrow">Every decision, accounted for</div><h1>Moderation activity</h1><p>Review flagged messages and see what Jev-Mod did. Evidence is retained for 30 days.</p><button className="btn btn-sm refresh" onClick={() => refresh().catch(error => notify(error.message))}>Refresh</button></header>
    <div className="stats-line"><div><strong>{data.stats.total}</strong><span>Recorded cases · 30 days</span></div><div><strong>{data.stats.review}</strong><span>Open for review</span></div><div><strong>{data.stats.removed}</strong><span>Messages removed</span></div></div>
    <div className="section-heading"><h2>Recent cases</h2><label className="filter">Show <select className="select select-sm" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">All cases</option><option value="review">Needs review</option></select></label></div>
    {rows.length ? <div className="table-wrap"><table className="table"><thead><tr><th>Message / rule</th><th>Match</th><th>Outcome</th><th>Time</th></tr></thead><tbody>{rows.map(item => <tr key={item.id}><td><button className="case-link" onClick={() => setSelected(item)}>{item.matches.map(match => match.name).join(', ')} <span>· #{item.id}</span></button><p className="excerpt">{item.content}</p></td><td className="mono">{percentage(Math.max(...item.matches.map(match => match.probability), 0))}</td><td><Outcome value={item.outcome} /></td><td className="muted">{date(item.created_at)}</td></tr>)}</tbody></table></div>
      : <section className="empty"><h2>No cases here</h2><p>{filter === 'review' ? 'No loaded cases need review.' : 'Matches will appear when Jev-Mod observes unwanted messages.'}</p></section>}
    {hasMore && <button className="btn btn-ghost btn-sm section-foot" disabled={busy} onClick={async () => {
      controller.current?.abort();
      const current = new AbortController();
      controller.current = current;
      setBusy(true);
      try {
        const result = await api<CaseRecord[]>(`/api/guilds/${guildId}/cases?before=${cases.at(-1)!.id}`, { signal: current.signal });
        if (!current.signal.aborted) { setOlder(previous => [...previous, ...result]); setHasMore(result.length === 50); }
      } catch (error) { if (!current.signal.aborted) notify((error as Error).message); }
      finally { if (!current.signal.aborted) setBusy(false); }
    }}>{busy ? 'Loading…' : 'Load older cases'}</button>}
    <p className="fine section-foot">{data.demo ? 'All messages and probabilities are sample data, not Jev results.' : 'Allowed message text is not stored. Failed actions remain visible in the case record.'}</p>
    {selected && <CaseDialog item={selected} guildId={guildId} demo={data.demo} close={() => setSelected(null)} complete={async message => { setSelected(null); notify(message); await refresh(); }} />}</>;
}
export function Outcome({ value }: { value: string }) {
  return <span className={`badge badge-sm ${value.includes('failed') ? 'badge-error badge-soft' : ['monitored', 'logged'].includes(value) ? 'badge-warning badge-soft' : value.startsWith('deleted') ? 'badge-success badge-soft' : 'badge-outline'}`}>{outcomeLabels[value] ?? value}</span>;
}
function CaseDialog({ item, guildId, demo, close, complete }: { item: CaseRecord; guildId: string; demo: boolean; close(): void; complete(message: string): Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  async function review(action: string) {
    if (action === 'delete' && !confirm('Permanently delete this Discord message? This cannot be undone.')) return;
    setBusy(true); setError('');
    try {
      const result = await api<{ outcome: string }>(`/api/guilds/${guildId}/cases/${item.id}/review`, { method: 'POST', body: JSON.stringify({ action }) });
      await complete(outcomeLabels[result.outcome] ?? result.outcome);
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="modal" onCancel={event => { if (busy) event.preventDefault(); else close(); }} onClose={close} aria-labelledby="case-title"><div className="modal-box case-modal"><header><div><div className="eyebrow">Moderation record</div><h2 id="case-title">Case #{item.id}</h2></div><button className="btn btn-ghost btn-sm btn-square" disabled={busy} aria-label="Close case" onClick={close}><X size={18} /></button></header>
    <Outcome value={item.outcome} /><pre>{item.content}</pre><dl><dt>Matched rules</dt><dd>{item.matches.map(match => `${match.name} (${percentage(match.probability)})`).join(', ')}</dd><dt>Requested action</dt><dd>{actionLabels[item.requested_action as keyof typeof actionLabels]}</dd><dt>Model</dt><dd>{item.model ?? 'Local rules'}</dd><dt>Member</dt><dd className="mono">{item.author_id}</dd><dt>Channel</dt><dd className="mono">{item.channel_id}</dd><dt>Time</dt><dd>{date(item.created_at)}</dd></dl>
    {error && <p role="alert" className="error">{error}</p>}<div className="modal-action">{reviewable(item) && <><button className="btn" disabled={busy} onClick={() => review('dismiss')}>Dismiss case</button><button className="btn btn-error btn-outline" disabled={busy || demo} title={demo ? 'Discord actions are disabled in preview' : undefined} onClick={() => review('delete')}>Delete message</button></>}</div></div></dialog>;
}
