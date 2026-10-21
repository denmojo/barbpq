import { useEffect } from 'preact/hooks';
import { checkSysop, sysop } from '../data/session';
import { PublicLayout } from '../public/PublicLayout';
import { SysopLayout } from '../sysop/SysopLayout';

/** The node sets this cookie at sign-in; without it there is no session to ask about. */
const hasSessionCookie = (): boolean => /(?:^|;\s*)BPQSessionCookie=N/.test(document.cookie);

/**
 * Signed in, the sysop shell takes every route; signed out, the public layout does, and
 * a sysop route there shows the sign-in screen. On load the app asks the node once
 * whether this browser still holds a sysop session.
 */
export function App() {
  useEffect(() => {
    if (sysop.peek() !== 'unknown') return;
    if (!hasSessionCookie()) {
      sysop.value = 'out';
      return;
    }
    // A node that does not answer leaves the visitor signed out; signing in asks again.
    checkSysop().catch(() => {
      sysop.value = 'out';
    });
  }, []);
  return sysop.value === 'in' ? <SysopLayout /> : <PublicLayout />;
}
