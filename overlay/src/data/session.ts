// Sysop sign-in and the retry-after-sign-in wrapper.
import { signal } from '@preact/signals';
import { getText, latin1Bytes, encodeLatin1Form, postBody, ParseError } from './http';
import { parseMailKey } from './pages';

export type SysopState = 'unknown' | 'in' | 'out';
export const sysop = signal<SysopState>('unknown');

/** A protected page or form answered "please sign in". */
export class NotAuthorizedError extends Error {
  constructor() {
    super('Not authorized - please sign in');
    this.name = 'NotAuthorizedError';
  }
}

/**
 * True for the node's "Not authorized - please sign in" reply (the Config save variant
 * reads "Not authorizedxx") and for the mail sign-in form that stands in for mail pages.
 */
export function isNotAuthorized(html: string): boolean {
  return /Not authorized\w* - please sign in/.test(html) || /action=\/?Mail\/Signon/i.test(html);
}

export function assertAuthorized(html: string): string {
  if (isNotAuthorized(html)) {
    sysop.value = 'out';
    throw new NotAuthorizedError();
  }
  return html;
}

/** GET a protected page, throwing NotAuthorizedError when the node asks for a sign-in. */
export async function getProtected(url: string): Promise<string> {
  return assertAuthorized(await getText(url));
}

export async function signIn(user: string, password: string): Promise<boolean> {
  const body = latin1Bytes(`user=${encodeLatin1Form(user)}&password=${encodeLatin1Form(password)}`);
  const reply = await postBody('/Node/Signon?Node', body);
  // A failed attempt returns the sign-in form again.
  const ok = !/name=password/i.test(reply);
  sysop.value = ok ? 'in' : 'out';
  if (ok) cachedKey = null;
  return ok;
}

let cachedKey: string | null = null;

/**
 * Find out whether this browser still holds a sysop session: the mail menu answers with
 * its session key only to a signed-in node cookie. Sets `sysop` to 'in' or 'out'.
 */
export async function checkSysop(): Promise<SysopState> {
  try {
    await mailKey();
    sysop.value = 'in';
  } catch (e) {
    if (!(e instanceof NotAuthorizedError)) throw e;
    sysop.value = 'out';
  }
  return sysop.peek();
}

/**
 * The node has no sign-out URL. Drop this browser's session cookie and the cached mail key;
 * the node forgets the session itself when it times out.
 */
export function signOut(): void {
  document.cookie = 'BPQSessionCookie=; Path=/; Max-Age=0';
  cachedKey = null;
  sysop.value = 'out';
}

/** Mail management key. A request with the node cookie creates the mail session. */
export async function mailKey(): Promise<string> {
  if (cachedKey) return cachedKey;
  const html = await getProtected('/Mail/Header');
  const key = parseMailKey(html);
  if (!key) throw new ParseError('Mail menu', 'session key');
  cachedKey = key;
  return key;
}

function waitForSignIn(): Promise<void> {
  if (sysop.peek() === 'in') return Promise.resolve();
  return new Promise((resolve) => {
    const stop = sysop.subscribe((v) => {
      if (v === 'in') {
        queueMicrotask(() => stop());
        resolve();
      }
    });
  });
}

/**
 * Run fn; if it throws NotAuthorizedError, mark the sysop signed out, wait for a sign-in
 * and run it once more. The caller keeps its own draft; nothing here touches it.
 */
export async function withSysop<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (!(e instanceof NotAuthorizedError)) throw e;
    sysop.value = 'out';
    cachedKey = null;
    await waitForSignIn();
    return fn();
  }
}
