import { createContext, useContext, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createRootRoute, createRoute, createRouter, RouterProvider, Outlet, useNavigate } from '@tanstack/react-router';
import type { Guild, SessionInfo } from '@jev-mod/core/types.ts';
import { api, authClient } from './api';
import { Dashboard, Brand } from './workspace';
import './styles.css';

type AppState = { session: SessionInfo; guilds: Guild[] };
const AppContext = createContext<AppState | null>(null);
export const useApp = () => useContext(AppContext)!;

function Root() {
  const [data, setData] = useState<AppState | null>(null);
  const [error, setError] = useState('');
  const [signingOut, setSigningOut] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      const session = await api<SessionInfo>('/api/session', { signal: controller.signal });
      const guilds = session.user ? await api<Guild[]>('/api/guilds', { signal: controller.signal }) : [];
      if (!controller.signal.aborted) setData({ session, guilds });
    })().catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, []);
  if (error) return <main className="center"><h1>Jev-Mod could not load</h1><p role="alert">{error}</p><button className="btn" disabled={signingOut} onClick={() => location.reload()}>Try again</button>
    <button className="btn btn-ghost" disabled={signingOut} onClick={async () => {
      setSigningOut(true);
      try {
        const result = await authClient.signOut();
        if (result.error) throw new Error(result.error.message ?? 'Sign-out failed.');
        location.assign('/');
      } catch (error) { setError((error as Error).message); setSigningOut(false); }
    }}>Sign out</button></main>;
  if (!data) return <main className="center" aria-busy="true"><span className="loading loading-spinner loading-sm" />Loading Jev-Mod…</main>;
  if (!data.session.user) return <Login inviteUrl={data.session.inviteUrl} />;
  return <AppContext.Provider value={data}><Outlet /></AppContext.Provider>;
}
function Login({ inviteUrl }: { inviteUrl: string | null }) {
  const [error, setError] = useState('');
  return <main className="login"><Brand /><h1>Moderation for your<br />Discord server.</h1>
    <button className="btn btn-primary" onClick={async () => {
      const result = await authClient.signIn.social({ provider: 'discord', callbackURL: location.origin });
      if (result.error) setError(result.error.message ?? 'Sign-in failed.');
    }}>Continue with Discord</button>{inviteUrl && <a className="btn btn-ghost" href={inviteUrl}>Add to Discord</a>}
    {error && <p role="alert" className="error">{error}</p>}
    <p className="fine">Manage Server permission is required. Message text is sent to TypeSafe for evaluation. Flagged evidence is kept for 30 days.</p></main>;
}
function Index() {
  const { guilds, session } = useApp();
  const navigate = useNavigate();
  useEffect(() => { if (guilds[0]) navigate({ to: '/servers/$guildId/$view', params: { guildId: guilds[0].id, view: 'rules' }, replace: true }); }, [guilds, navigate]);
  if (guilds.length) return <main className="center" aria-busy="true">Opening server…</main>;
  return <main className="login"><Brand /><h1>No servers to manage</h1><p>Sign in with an account that has Manage Server permission, or install Jev-Mod.</p>
    {session.inviteUrl && <a className="btn btn-primary" href={session.inviteUrl}>Add to Discord</a>}
    <button className="btn btn-ghost" onClick={async () => { await authClient.signOut(); location.reload(); }}>Sign out</button></main>;
}
function Server() {
  const { guildId, view } = serverRoute.useParams();
  return <Dashboard key={guildId} guildId={guildId} view={['rules', 'activity', 'settings'].includes(view) ? view : 'rules'} />;
}
const rootRoute = createRootRoute({ component: Root });
const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: Index });
const serverRoute = createRoute({ getParentRoute: () => rootRoute, path: '/servers/$guildId/$view', component: Server });
const router = createRouter({ routeTree: rootRoute.addChildren([indexRoute, serverRoute]), defaultPreload: 'intent', scrollRestoration: true });
declare module '@tanstack/react-router' { interface Register { router: typeof router } }
createRoot(document.getElementById('app')!).render(<RouterProvider router={router} />);
