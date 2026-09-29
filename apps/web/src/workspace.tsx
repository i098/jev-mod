import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useBlocker, useNavigate } from '@tanstack/react-router';
import { ShieldCheck, SlidersHorizontal, ListFilter } from 'lucide-react';
import type { DashboardData, PolicyRecord } from '@jev-mod/core/types.ts';
import type { Settings as Policy } from '@jev-mod/core/policy.ts';
import { api, ApiError, authClient } from './api';
import { useApp } from './main';
import { Rules } from './rules';
import { Settings } from './settings';
import { Activity } from './activity';

export function Brand() { return <Link to="/" className="brand" aria-label="Jev-Mod home"><ShieldCheck size={33} strokeWidth={1.5} /><span>jev<span>·</span>mod</span></Link>; }
export function Dashboard({ guildId, view }: { guildId: string; view: string }) {
  const { session, guilds } = useApp();
  const [data, setData] = useState<DashboardData | null>(null);
  const [draft, setDraft] = useState<Policy | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const controller = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const navigate = useNavigate();
  const guild = guilds.find(item => item.id === guildId);
  const dirty = data && draft ? JSON.stringify(draft) !== JSON.stringify(data.settings) : false;
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  useBlocker({
    enableBeforeUnload: () => dirtyRef.current,
    shouldBlockFn: ({ next }) => {
      if (!dirtyRef.current || ('guildId' in next.params && next.params.guildId === guildId)) return false;
      return !confirm('Discard unsaved changes and leave this server?');
    },
  });
  const load = useCallback(async () => {
    controller.current?.abort(); controller.current = new AbortController();
    const current = controller.current;
    const result = await api<DashboardData>(`/api/guilds/${guildId}`, { signal: current.signal });
    if (current.signal.aborted || !alive.current) return;
    // A case refresh must not overwrite policy edits made in another dashboard view.
    if (!dirtyRef.current) { setData(result); setDraft(structuredClone(result.settings)); }
    else setData(previous => previous ? { ...result, settings: previous.settings, version: previous.version } : result);
    setError('');
  }, [guildId]);
  useEffect(() => {
    alive.current = true;
    if (guild?.installed) load().catch(error => { if (error.name !== 'AbortError' && alive.current) setError(error.message); });
    return () => { alive.current = false; controller.current?.abort(); };
  }, [load, guild?.installed]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 6000); return () => clearTimeout(timer); }, [toast]);
  const navigation = [{ view: 'rules', label: 'Auto moderation', icon: ShieldCheck }, { view: 'activity', label: 'Activity', icon: ListFilter }, { view: 'settings', label: 'Server settings', icon: SlidersHorizontal }];
  async function save() {
    if (!draft || !data) return;
    setBusy(true);
    try {
      const normalized = { ...draft, blockedPhrases: draft.blockedPhrases.map(item => item.trim()).filter(Boolean) };
      const policy = await api<PolicyRecord>(`/api/guilds/${guildId}/settings`, { method: 'PUT', body: JSON.stringify({ settings: normalized, version: data.version }) });
      if (!alive.current) return;
      dirtyRef.current = false;
      setData({ ...data, ...policy }); setDraft(structuredClone(policy.settings));
      setToast(session.demo ? 'Preview settings saved locally.' : 'Server settings saved.'); await load();
    } catch (error) {
      if (!alive.current) return;
      if (error instanceof ApiError && error.status === 401) { setData(null); setDraft(null); setError(error.message); }
      else setToast((error as Error).message);
    } finally { if (alive.current) setBusy(false); }
  }
  async function signOut() {
    if (dirtyRef.current && !confirm('Discard unsaved changes and sign out?')) return;
    setBusy(true);
    try {
      const result = await authClient.signOut();
      if (result.error) throw new Error(result.error.message ?? 'Sign-out failed.');
      dirtyRef.current = false; setDraft(null);
      location.assign('/');
    } catch (error) { setToast((error as Error).message); setBusy(false); }
  }
  return <div className="shell"><a className="skip" href="#main">Skip to content</a><aside className="sidebar"><Brand />
    <div><label htmlFor="server" className="server-label">YOUR SERVER</label><select id="server" className="select server-select" aria-label="Select server" value={guildId} disabled={busy} onChange={event => {
      navigate({ to: '/servers/$guildId/$view', params: { guildId: event.target.value, view } });
    }}>{guilds.map(item => <option key={item.id} value={item.id}>{item.name}{item.installed ? '' : ' · Add bot'}</option>)}</select></div>
    <nav aria-label="Dashboard" className="menu nav">{navigation.map(item => <Link key={item.view} to="/servers/$guildId/$view" params={{ guildId, view: item.view }} className={view === item.view ? 'active' : ''} aria-current={view === item.view ? 'page' : undefined} onClick={event => { if (busy) event.preventDefault(); }}><item.icon size={17} strokeWidth={1.5} />{item.label}{item.view === 'activity' && <span className="badge badge-sm nav-count">{data?.stats.review ?? 0}</span>}</Link>)}</nav>
    <div className="sidebar-bottom"><div className="connection"><span className={`status status-xs ${data?.health.connected ? 'status-success' : ''}`} />{session.demo ? 'Preview · not connected' : !guild?.installed ? 'Bot not installed' : data?.health.connected ? 'Discord connected' : 'Discord not connected'}</div>
      <div className="user-row"><div className="avatar placeholder"><div>{session.user?.name.slice(0, 2).toUpperCase()}</div></div><div><p>{session.user?.name}</p><button disabled={session.demo || busy} onClick={signOut}>Sign out</button></div></div></div></aside>
    <div className="workspace">{session.demo && <div className="demo-banner"><strong>Local preview</strong> · Sample servers and cases. No Discord or Jev connection.</div>}
      <header className="topbar"><div>{guild?.name ?? 'Server'} <span>/</span> <strong>{navigation.find(item => item.view === view)?.label}</strong></div>{data && <span className={`badge badge-sm ${data.settings.mode === 'protect' ? 'badge-success badge-soft' : data.settings.mode === 'monitor' ? 'badge-warning badge-soft' : 'badge-outline'}`}>{({ monitor: 'Monitoring', protect: 'Protection enabled', off: 'Moderation paused' })[data.settings.mode]}</span>}</header>
      <main id="main" className="content">{!guild?.installed ? <section className="empty"><h1>Add Jev-Mod to this server</h1><p>{new URLSearchParams(location.search).get('installed') === '1' ? 'Discord is still syncing this installation. Refresh servers in a moment.' : 'Install the bot to configure moderation.'}</p>{guild?.inviteUrl && <a className="btn btn-primary" href={guild.inviteUrl}>Add to Discord</a>}<button className="btn" onClick={() => location.reload()}>Refresh servers</button></section>
        : error ? <section className="empty"><h1>Server could not load</h1><p role="alert">{error}</p><button className="btn" onClick={() => load().catch(error => setError(error.message))}>Try again</button></section>
        : !data || !draft ? <div className="center" aria-busy="true"><span className="loading loading-spinner loading-sm" />Loading server…</div>
        : view === 'rules' ? <Rules draft={draft} update={setDraft} guildId={guildId} demo={session.demo} disabled={busy} keyStatus={data.keyStatus} />
        : view === 'settings' ? <Settings data={data} draft={draft} update={setDraft} disabled={busy} guildId={guildId} keyStatusChanged={keyStatus => {
          setData(previous => previous ? { ...previous, keyStatus } : previous);
          void load().catch(error => { if (error.name !== 'AbortError') setToast(error.message); });
        }} />
        : <Activity data={data} refresh={load} guildId={guildId} notify={setToast} />}</main>
      {dirty && <footer className="savebar"><p>Unsaved changes</p><div><button className="btn btn-ghost" disabled={busy} onClick={() => setDraft(structuredClone(data!.settings))}>Discard</button><button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save changes'}</button></div></footer>}</div>
    {toast && <div className="toast toast-end" role="status"><div className="alert">{toast}</div></div>}</div>;
}
