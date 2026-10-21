import { assertAuthorized, isMailSessionLost, isNotAuthorized, signIn, sysop, mailKey, signOut, withSysop, NotAuthorizedError } from '../session';
import { parseMailKey } from '../pages';
import { fixture, stubFetch } from './helpers';

afterEach(() => {
  vi.unstubAllGlobals();
  sysop.value = 'unknown';
});

test('isNotAuthorized: true for the node reply and the mail sign-in form, false for real pages', () => {
  expect(isNotAuthorized(fixture('node-not-authorized.html'))).toBe(true);
  expect(isNotAuthorized('x Not authorizedxx - please sign in')).toBe(true);
  expect(isNotAuthorized('<form action=/Mail/Signon?Mail>')).toBe(true);
  expect(isNotAuthorized(fixture('node-stats.html'))).toBe(false);
  expect(isNotAuthorized(fixture('mail-header.html'))).toBe(false);
});

test('signIn posts user and password; the menu reply means success, the form again means failure', async () => {
  let sent = '';
  const calls = stubFetch({
    '/Node/Signon?Node': (init) => {
      sent = new TextDecoder().decode(init?.body as Uint8Array);
      return sent.includes('password=staging') ? fixture('node-signon.html') : '<form><input name=password></form>';
    },
  });
  expect(await signIn('sysop', 'staging')).toBe(true);
  expect(sent).toBe('user=sysop&password=staging');
  expect(sysop.value).toBe('in');
  expect(calls[0]?.init?.method).toBe('POST');
  expect(await signIn('sysop', 'wrong')).toBe(false);
  expect(sysop.value).toBe('out');
});

test('signIn takes only the node menu as success; any other reply is an error naming it', async () => {
  const menu = fixture('node-signon.html');
  let reply = '<html><body><p>Server busy, try later</p></body></html>';
  stubFetch({ '/Node/Signon?Node': () => reply });
  await expect(signIn('sysop', 'staging')).rejects.toThrow(/Server busy, try later/);
  expect(sysop.value).toBe('out');
  reply = menu.slice(0, Math.floor(menu.length / 2));   // a truncated menu
  await expect(signIn('sysop', 'staging')).rejects.toThrow(/unexpected reply/);
  expect(sysop.value).toBe('out');
  reply = menu;
  expect(await signIn('sysop', 'staging')).toBe(true);
  expect(sysop.value).toBe('in');
});

test('mailKey reads the key from /Mail/Header, and a sign-in page is not authorized', async () => {
  stubFetch({ '/Mail/Header': fixture('mail-header.html') });
  expect(await mailKey()).toMatch(/^M[0-9A-F]+$/);
  vi.unstubAllGlobals();
  stubFetch({ '/Mail/Header': '<form action=/Mail/Signon?Mail></form>' });
  await signIn('x', 'y').catch(() => {});
  // cached key survives; a fresh sign-in clears it
  expect(await mailKey()).toMatch(/^M[0-9A-F]+$/);
});

test('withSysop keeps the caller draft, waits for sign-in, retries once', async () => {
  const draft = { text: 'my edit' };
  const seen: string[] = [];
  let attempts = 0;
  const p = withSysop(async () => {
    attempts++;
    seen.push(draft.text);
    if (attempts === 1) throw new NotAuthorizedError();
    return 'saved';
  });
  await vi.waitFor(() => expect(sysop.value).toBe('out'));
  expect(attempts).toBe(1);
  stubFetch({ '/Node/Signon?Node': fixture('node-signon.html') });
  await signIn('sysop', 'staging');
  expect(await p).toBe('saved');
  expect(attempts).toBe(2);
  expect(seen).toEqual(['my edit', 'my edit']);
});

test('withSysop retries only once and passes other errors through', async () => {
  sysop.value = 'in';
  let n = 0;
  await expect(withSysop(async () => { n++; throw new Error('boom'); })).rejects.toThrow('boom');
  expect(n).toBe(1);
  const p = withSysop(async () => { n++; throw new NotAuthorizedError(); });
  const caught = p.catch((e: unknown) => e);
  await vi.waitFor(() => expect(sysop.value).toBe('out'));
  sysop.value = 'in';
  expect(await caught).toBeInstanceOf(NotAuthorizedError);
  expect(n).toBe(3);
});

test('a mail key the node has dropped ("Session had been lost") gets a fresh key and one retry, with no sign-in', async () => {
  const header = fixture('mail-header.html');
  const old = parseMailKey(header) as string;
  let headers = 0;
  let lost = true;
  stubFetch({
    '/Mail/Header': () => { headers += 1; return header; },
    [`/Mail/Status?${old}`]: () => { if (lost) { lost = false; return fixture('mail-lost.html'); } return 'status page'; },
  });
  signOut();
  sysop.value = 'in';
  const run = withSysop(async () => assertAuthorized(await (await fetch(`/Mail/Status?${await mailKey()}`)).text()));
  await expect(run).resolves.toBe('status page');
  expect(headers).toBe(2);
  expect(sysop.value).toBe('in');
  expect(isNotAuthorized(fixture('mail-lost.html'))).toBe(false);
  expect(isMailSessionLost(fixture('mail-lost.html'))).toBe(true);
});

test('a lost mail session whose cookie is gone too falls through to the sign-in and retry', async () => {
  let signedOut = false;
  stubFetch({
    '/Mail/Header': () => (signedOut ? '<form action=/Mail/Signon?Mail>' : fixture('mail-header.html')),
    [`/Mail/Status?${parseMailKey(fixture('mail-header.html'))}`]: () => { signedOut = true; return fixture('mail-lost.html'); },
  });
  signOut();
  sysop.value = 'in';
  const run = withSysop(async () => assertAuthorized(await (await fetch(`/Mail/Status?${await mailKey()}`)).text()));
  await vi.waitFor(() => expect(sysop.value).toBe('out'));
  signedOut = false;
  stubFetch({ '/Mail/Header': fixture('mail-header.html'), [`/Mail/Status?${parseMailKey(fixture('mail-header.html'))}`]: 'ok' });
  sysop.value = 'in';
  await expect(run).resolves.toBe('ok');
});
