import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { catalog } from '@jev-mod/core/policy.ts';
import type { CaseRecord, DashboardData } from '@jev-mod/core/types.ts';
import { actionLabels, api, date, outcomeLabels, percentage, reviewable } from './api';

const emptyFilters = { search: '', outcome: '', rule: '', channel: '', from: '', to: '' };
export function Activity({ data, refresh, guildId, notify }: { data: DashboardData; refresh(): Promise<void>; guildId: string; notify(message: string): void }) {
  const [filters, setFilters] = useState(emptyFilters);
  const [rows, setRows] = useState<CaseRecord[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [selected, setSelected] = useState<CaseRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  const region = useRef<HTMLDivElement>(null);
  const params = new URLSearchParams();
  for (const field of ['search', 'outcome', 'rule', 'channel'] as const) if (filters[field].trim()) params.set(field, filters[field].trim());
  if (filters.from) params.set('from', String(new Date(`${filters.from}T00:00:00`).getTime()));
  if (filters.to) {
    const end = new Date(`${filters.to}T00:00:00`); end.setDate(end.getDate() + 1);
    params.set('to', String(end.getTime() - 1));
  }
  const query = params.toString();
  const invalid = filters.from && filters.to && filters.from > filters.to ? 'End date must follow start date.'
    : filters.channel && !/^\d{17,20}$/.test(filters.channel.trim()) ? 'Choose a channel ID from the suggestions, or enter its full ID.' : '';
  const identity = useMemo(() => ({ data, guildId, query, invalid }), [data, guildId, query, invalid]);
  const currentIdentity = useRef(identity); currentIdentity.current = identity;
  const load = useCallback(async (before?: number | string) => {
    controller.current?.abort();
    const current = new AbortController(); controller.current = current;
    if (before === undefined) { setRows([]); setHasMore(false); region.current?.scrollTo(0, 0); }
    setError('');
    if (identity.invalid) { setBusy(false); return; }
    setBusy(true);
    const request = new URLSearchParams(identity.query);
    if (before !== undefined) request.set('before', String(before));
    try {
      const result = await api<CaseRecord[]>(`/api/guilds/${identity.guildId}/cases?${request}`, { signal: current.signal });
      if (current.signal.aborted || currentIdentity.current !== identity) return;
      setRows(previous => before === undefined ? result : [...previous, ...result]); setHasMore(result.length === 50);
    } catch (error) {
      if (!current.signal.aborted && currentIdentity.current === identity) setError((error as Error).message);
    } finally { if (!current.signal.aborted && currentIdentity.current === identity) setBusy(false); }
  }, [identity]);
  useEffect(() => {
    setSelected(null); setRows([]); setHasMore(false); setBusy(!invalid);
    const timer = setTimeout(() => { void load(); }, 200);
    return () => { clearTimeout(timer); controller.current?.abort(); };
  }, [load, invalid]);
  const change = (field: keyof typeof emptyFilters, value: string) => { controller.current?.abort(); setFilters(previous => ({ ...previous, [field]: value })); };
  const channelOptions = data.metadata.channels.filter(channel => `${channel.id} ${channel.name}`.toLocaleLowerCase().includes(filters.channel.toLocaleLowerCase())).slice(0, 40);
  return <><header className="page-title"><h1>Moderation activity</h1><button className="btn btn-sm refresh" disabled={refreshing} onClick={async () => {
      controller.current?.abort(); setRefreshing(true); setSelected(null);
      try { await refresh(); } catch (error) { notify((error as Error).message); void load(); }
      finally { setRefreshing(false); }
    }}>{refreshing ? 'Refreshing…' : 'Refresh'}</button></header>
    <div className="activity-summary" role="group" aria-label="Case totals for the last 30 days">{[
      { value: '', count: data.stats.total, label: 'All cases' }, { value: 'review', count: data.stats.review, label: 'Needs review' }, { value: 'removed', count: data.stats.removed, label: 'Removed' },
    ].map(item => <button key={item.label} className={filters.outcome === item.value ? 'active' : ''} aria-pressed={filters.outcome === item.value} onClick={() => change('outcome', item.value)}><strong>{item.count}</strong><span>{item.label}</span></button>)}<span className="summary-period">Last 30 days</span></div>
    <div className="case-filters"><label className="field case-search">Search cases<input className="input input-sm" type="search" maxLength={200} value={filters.search} onChange={event => change('search', event.target.value)} placeholder="Message text" /></label>
      <label className="field">Outcome<select className="select select-sm" value={filters.outcome} onChange={event => change('outcome', event.target.value)}><option value="">All outcomes</option><option value="review">Needs review</option><option value="removed">Removed</option>{Object.entries(outcomeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="field">Rule<select className="select select-sm" value={filters.rule} onChange={event => change('rule', event.target.value)}><option value="">All rules</option>{[...catalog, { id: 'phrases', name: 'Blocked phrase' }, { id: 'mentions', name: 'Excessive mentions' }].map(rule => <option key={rule.id} value={rule.id}>{rule.name}</option>)}</select></label>
      <label className="field">Channel<input className="input input-sm" list="case-channels" value={filters.channel} onChange={event => change('channel', event.target.value)} placeholder="Name or ID" /><datalist id="case-channels">{channelOptions.map(channel => <option key={channel.id} value={channel.id}># {channel.name}</option>)}</datalist></label>
      <label className="field">From<input className="input input-sm" type="date" value={filters.from} onChange={event => change('from', event.target.value)} /></label><label className="field">Through<input className="input input-sm" type="date" value={filters.to} min={filters.from} onChange={event => change('to', event.target.value)} /></label>
      {Object.values(filters).some(Boolean) && <button className="btn btn-ghost btn-sm clear-filters" onClick={() => { controller.current?.abort(); setFilters(emptyFilters); }}>Clear filters</button>}
    </div>
    {(error || invalid) && <p role="alert" className="error case-error">{error || invalid}{error && <button className="btn btn-ghost btn-sm" onClick={() => load()}>Retry cases</button>}</p>}
    <div ref={region} className="table-wrap case-region" role="region" aria-label="Moderation cases" tabIndex={0} aria-busy={busy || refreshing}><table className="table"><thead><tr><th>Message / rule</th><th>Match</th><th>Outcome</th><th>Time</th></tr></thead><tbody>{rows.map(item => <tr key={item.id}><td><button className="case-link" onClick={() => setSelected(item)}>{item.matches.map(match => match.name).join(', ') || 'Case'} <span>· #{item.id}</span></button><p className="excerpt">{item.content}</p></td><td className="mono">{percentage(Math.max(...item.matches.map(match => match.probability), 0))}</td><td><Outcome value={item.outcome} /></td><td className="muted">{date(item.created_at)}</td></tr>)}</tbody></table>{!rows.length && <div className="case-empty" role="status">{busy || refreshing ? 'Loading cases…' : invalid ? 'Update filters to search.' : error ? 'Cases could not load.' : 'No matching cases.'}</div>}</div>
    <div className="case-pagination"><span role="status">{rows.length} cases loaded</span>{hasMore && <button className="btn btn-ghost btn-sm" disabled={busy || refreshing} onClick={() => load(rows.at(-1)!.id)}>{busy ? 'Loading…' : 'Load older cases'}</button>}</div>
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
  return <dialog ref={dialog} className="modal" onCancel={event => { if (busy) event.preventDefault(); else close(); }} onClose={close} aria-labelledby="case-title"><div className="modal-box case-modal"><header><div><h2 id="case-title">Case #{item.id}</h2></div><button className="btn btn-ghost btn-sm btn-square" disabled={busy} aria-label="Close case" onClick={close}><X size={18} /></button></header>
    <Outcome value={item.outcome} /><pre>{item.content}</pre><dl><dt>Matched rules</dt><dd>{item.matches.map(match => `${match.name} (${percentage(match.probability)})`).join(', ')}</dd><dt>Requested action</dt><dd>{actionLabels[item.requested_action as keyof typeof actionLabels]}</dd><dt>Model</dt><dd>{item.model ?? 'Local rules'}</dd><dt>Member</dt><dd className="mono">{item.author_id}</dd><dt>Channel</dt><dd className="mono">{item.channel_id}</dd><dt>Time</dt><dd>{date(item.created_at)}</dd></dl>
    {error && <p role="alert" className="error">{error}</p>}<div className="modal-action">{reviewable(item) && <><button className="btn" disabled={busy} onClick={() => review('dismiss')}>Dismiss case</button><button className="btn btn-error btn-outline" disabled={busy || demo} title={demo ? 'Discord actions are disabled in preview' : undefined} onClick={() => review('delete')}>Delete message</button></>}</div></div></dialog>;
}
