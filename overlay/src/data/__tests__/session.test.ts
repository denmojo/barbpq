import { isNotAuthorized, signIn, sysop, mailKey, withSysop, NotAuthorizedError } from '../session';
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
