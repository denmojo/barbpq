import { useEffect, useRef, useState } from 'preact/hooks';
import { signIn } from '../data/session';
import { IconLock } from './icons';

/**
 * SysOp sign-in. The user name and password live only in this form's state and the one
 * request; nothing is stored or logged, and the password field is cleared after each try.
 */
export function SignIn() {
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ title: string; hint: string } | null>(null);
  const userRef = useRef<HTMLInputElement>(null);
  const passRef = useRef<HTMLInputElement>(null);
  useEffect(() => userRef.current?.focus(), []);

  const submit = async (e: Event): Promise<void> => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const ok = await signIn(user, password);
      if (!ok) {
        setError({ title: 'Sign-in failed', hint: 'Check the user name and password. Only node users marked SYSOP can sign in.' });
        setPassword('');
        passRef.current?.focus();
      }
    } catch (err) {
      setError({ title: 'Sign-in failed', hint: `The node did not answer: ${err instanceof Error ? err.message : String(err)}` });
      setPassword('');
      passRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="signin">
      <form class="card signin-card" onSubmit={submit} aria-labelledby="signin-title" autocomplete="on">
        <div class="signin-ico"><IconLock /></div>
        <h1 id="signin-title">SysOp sign in</h1>
        <p class="signin-sub">
          Sign in with a node user that has SYSOP rights.
        </p>
        {error && (
          <div class="errnote" role="alert">
            <span class="errdot" aria-hidden="true" />
            <span><b>{error.title}</b>. {error.hint}</span>
          </div>
        )}
        <label class="field">
          <span>User</span>
          <input ref={userRef} name="user" type="text" autocomplete="username" autocapitalize="off" spellcheck={false}
            required value={user} onInput={(e) => setUser((e.target as HTMLInputElement).value)} />
        </label>
        <label class="field">
          <span>Password</span>
          <input ref={passRef} name="password" type="password" autocomplete="current-password"
            required value={password} onInput={(e) => setPassword((e.target as HTMLInputElement).value)} />
        </label>
        <button type="submit" class="btn primary signin-go" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
