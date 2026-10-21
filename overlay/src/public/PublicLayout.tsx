import type { FunctionComponent } from 'preact';
import { useEffect } from 'preact/hooks';
import { getInfo } from '../data/api';
import { usePoll } from '../data/poll';
import { route, type Route } from '../app/router';
import { Header } from './Header';
import { nodeVersion } from './Footer';
import { Overview } from './Overview';
import { Ports } from './Ports';
import { Heard } from './Heard';
import { LinksRoutes } from './LinksRoutes';
import { Sessions } from './Sessions';
import { sysop } from '../data/session';
import { Skel } from '../ui/Skel';
import { SignIn } from '../sysop/SignIn';
import './public.css';

export const PUBLIC_NAME = 'BarBPQ - LinBPQ Web UI';

const SCREENS: Partial<Record<Route, FunctionComponent>> = {
  overview: Overview, ports: Ports, heard: Heard, links: LinksRoutes, sessions: Sessions,
};

/** While the app asks the node whether this browser is still signed in. */
function CheckingSignIn() {
  return <div class="signin" aria-busy="true"><div class="card signin-card"><Skel /></div></div>;
}

/** The page a visitor sees before signing in: header, then the screen for the current route. */
export function PublicLayout() {
  const info = usePoll(getInfo, 60_000);
  const call = info.data?.NodeCall;
  useEffect(() => {
    document.title = call ? `${call} · ${PUBLIC_NAME}` : PUBLIC_NAME;
  }, [call]);
  useEffect(() => {
    if (info.data) nodeVersion.value = info.data.Version;
  }, [info.data]);

  const r = route.value;
  const Screen = SCREENS[r] ?? (sysop.value === 'unknown' ? CheckingSignIn : SignIn);
  return (
    <div class="pub">
      <Header info={info} current={r} />
      <main class="pub-main">
        <Screen />
      </main>
    </div>
  );
}
