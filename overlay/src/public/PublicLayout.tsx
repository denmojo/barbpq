import { getInfo } from '../data/api';
import { usePoll } from '../data/poll';
import { route } from '../app/router';
import { sysop } from '../data/session';
import { Skel } from '../ui/Skel';
import { SignIn } from '../sysop/SignIn';
import { Header } from './Header';
import { PUBLIC_SCREENS, useDocTitle } from './screens';
import './public.css';

export { PUBLIC_NAME } from './screens';

/** While the app asks the node whether this browser is still signed in. */
function CheckingSignIn() {
  return <div class="signin" aria-busy="true"><div class="card signin-card"><Skel /></div></div>;
}

/** The page a visitor sees before signing in: header, then the screen for the current route. */
export function PublicLayout() {
  const info = usePoll(getInfo, 60_000);
  useDocTitle(info);

  const r = route.value;
  const Screen = PUBLIC_SCREENS[r] ?? (sysop.value === 'unknown' ? CheckingSignIn : SignIn);
  return (
    <div class="pub">
      <Header info={info} current={r} />
      <main class="pub-main">
        <Screen />
      </main>
    </div>
  );
}
