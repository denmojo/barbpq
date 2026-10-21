// Message, forwarding and white pages actions against replies captured from the staging node
// (scripts/capture-mail-actions.sh).
import { bytesOf, fixture } from '../../../data/__tests__/helpers';
import { signOut, sysop } from '../../../data/session';
import { ChangedOnNodeError, deleteRecord, LastWpRecordError, startForwarding } from '../maildata';
import {
  loadMessage, MessageGoneError, msgSaveBody, MsgFieldError, parseMessageDetail, readMessageText, releaseStatus,
  setStatus, saveMessage, stepForward, MAX_TEXT_BYTES, type MessageDetail,
} from '../msgactions';
import { KEY } from './sample';

type Hit = string | ((body: string) => string);
interface Call { path: string; method: string; body: string }

/** Stub the node: routes by path (the key is checked), each a reply or a function of the body. */
function node(routes: Record<string, Hit>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const raw = init?.body as Uint8Array | undefined;
    const body = raw ? Array.from(raw, (b) => String.fromCharCode(b)).join('') : '';
    const [path, ...rest] = url.split('?');
    if (path !== '/Mail/Header' && rest[0] !== KEY) return new Response('bad key', { status: 500 });
    calls.push({ path: path as string, method: init?.method ?? 'GET', body });
    const hit = routes[path as string];
    if (hit === undefined) return new Response('nope', { status: 404 });
    return new Response(bytesOf(typeof hit === 'function' ? hit(body) : hit), { status: 200 });
  });
  return calls;
}

const HEADER = fixture('mail-header.html');
const DETAILS2 = fixture('mail-msgdetails-2.html');
const SIGNON = '<html><body><form method=post action=/Mail/Signon?Mail>Not signed in</form></body></html>';
const LOST = fixture('mail-lost.html');
const posts = (calls: Call[], path: string) => calls.filter((c) => c.method === 'POST' && c.path === `/Mail/${path}`);
const held = (): MessageDetail => parseMessageDetail(DETAILS2, 2);

beforeEach(() => { signOut(); sysop.value = 'in'; });
afterEach(() => { vi.unstubAllGlobals(); sysop.value = 'unknown'; });

test('parseMessageDetail reads every field and the forwarding table of a staging MsgDetails reply', () => {
  expect(held()).toEqual({
    id: 2, bid: '2_AD6DM', type: 'P', status: 'H', to: 'SYSOP', from: 'N0CALL', via: '', size: 7, subject: 'uiapi test',
    sent: '20-Oct 23:52Z', rx: '20-Oct 23:52Z', lastChange: '20-Oct 23:52Z', efrom: '', attachments: false,
    fwd: [{ bbs: 1, call: 'AD6DM', state: 'none' }, { bbs: 2, call: 'RMS', state: 'none' }],
  });
  expect(parseMessageDetail(fixture('mail-msgfwdupdate-4-queued.html'), 4).fwd[1]).toEqual({ bbs: 2, call: 'RMS', state: 'queued' });
  expect(parseMessageDetail(fixture('mail-msgfwdupdate-4-sent.html'), 4).fwd[1]).toEqual({ bbs: 2, call: 'RMS', state: 'sent' });
  expect(() => parseMessageDetail(fixture('mail-msgdetails-missing.html'), 2)).toThrow(/record from Message 2/);
});

test('msgSaveBody: From|To|BID|EFROM|VIA|Title|Type|Status|, untouched fields as the node sent them', () => {
  const m = held();
  const text = (b: Uint8Array) => Array.from(b, (x) => String.fromCharCode(x)).join('');
  expect(text(msgSaveBody(m, {}))).toBe('N0CALL|SYSOP|2_AD6DM|||uiapi test|P|H|');
  expect(text(msgSaveBody(m, { status: 'N' }))).toBe('N0CALL|SYSOP|2_AD6DM|||uiapi test|P|N|');
  // A Latin-1 byte the node holds goes back as that byte; typed text goes as UTF-8, as the old page sends it.
  const latin = { ...m, subject: 'caf\xe9' };
  expect(Array.from(msgSaveBody(latin, {})).slice(-9)).toEqual([...'caf\xe9|P|H|'].map((c) => c.charCodeAt(0)));
  expect(Array.from(msgSaveBody(m, { subject: 'café' })).slice(23, 29)).toEqual([0x63, 0x61, 0x66, 0xc3, 0xa9, 0x7c]);
  expect(() => msgSaveBody(m, { subject: 'a|b' })).toThrow(MsgFieldError);
  expect(() => msgSaveBody(m, { from: 'N0CALLX' })).toThrow(/From is 7 bytes; the node keeps at most 6/);
  expect(() => msgSaveBody(m, { subject: 'x'.repeat(61) })).toThrow(/at most 60/);
  expect(() => msgSaveBody(m, { status: 'Q' })).toThrow(/Status must be one of/);
  expect(() => msgSaveBody(m, { to: 'A\nB' })).toThrow(/line break/);
});

test('release gives N, or $ for a bulletin still queued to a partner, as the BBS unhold command does', () => {
  expect(releaseStatus(held())).toBe('N');
  expect(releaseStatus({ ...held(), type: 'B', fwd: [{ bbs: 2, call: 'RMS', state: 'queued' }] })).toBe('$');
  expect(releaseStatus({ ...held(), type: 'B', fwd: [{ bbs: 2, call: 'RMS', state: 'sent' }] })).toBe('N');
});

test('release: MsgDetails then MsgSave with status N, one job; the node answers with the message as saved', async () => {
  const calls = node({ '/Mail/Header': HEADER, '/Mail/MsgDetails': DETAILS2, '/Mail/MsgSave': fixture('mail-msgsave-2-released.html') });
  const out = await setStatus(held(), releaseStatus(held()));
  expect(out.interrupted).toBe(false);
  expect(out.value.status).toBe('N');
  expect(calls.map((c) => `${c.path} ${c.body}`)).toEqual([
    '/Mail/Header ', '/Mail/MsgDetails 2', '/Mail/MsgSave N0CALL|SYSOP|2_AD6DM|||uiapi test|P|N|',
  ]);
});

test('hold and kill post the same record with H and K', async () => {
  const one = parseMessageDetail(DETAILS2.replace('<h4>Message 2</h4>', '<h4>Message 1</h4>')
    .replace('value=N0CALL', 'value=SYSTEM').replace('"2_AD6DM"', '"1_AD6DM"').replace('"uiapi test"', '"New User N0CALL"')
    .replace('<option selected value=H>', '<option  value=H>').replace('<option  value=N>', '<option selected value=N>'), 1);
  const calls = node({
    '/Mail/Header': HEADER,
    '/Mail/MsgDetails': (b) => (b === '1' ? fixture('mail-msgsave-1-killed.html').replace('<option selected value=K>', '<option  value=K>').replace('<option  value=N>', '<option selected value=N>') : DETAILS2),
    '/Mail/MsgSave': (b) => (b.endsWith('|K|') ? fixture('mail-msgsave-1-killed.html') : fixture('mail-msgsave-2-held.html')),
  });
  expect((await setStatus(one, 'K')).value.status).toBe('K');
  expect(posts(calls, 'MsgSave').map((c) => c.body)).toEqual(['SYSTEM|SYSOP|1_AD6DM|||New User N0CALL|P|K|']);
});

test('a message the node no longer has is never saved: MsgSave after an empty MsgDetails would crash it', async () => {
  const calls = node({ '/Mail/Header': HEADER, '/Mail/MsgDetails': fixture('mail-msgdetails-missing.html'), '/Mail/MsgSave': 'x' });
  await expect(setStatus(held(), 'K')).rejects.toBeInstanceOf(MessageGoneError);
  await expect(readMessageText(2, 7)).rejects.toBeInstanceOf(MessageGoneError);
  expect(posts(calls, 'MsgSave')).toEqual([]);
  expect(calls.some((c) => c.path === '/Mail/EditM')).toBe(false);
});

test('a status changed on the node since the message was opened is not overwritten', async () => {
  const released = fixture('mail-msgsave-2-released.html');
  const calls = node({ '/Mail/Header': HEADER, '/Mail/MsgDetails': released, '/Mail/MsgSave': 'x' });
  await expect(setStatus(held(), 'K')).rejects.toBeInstanceOf(ChangedOnNodeError);
  // The edit form compares every field.
  await expect(saveMessage(parseMessageDetail(released.replace('"uiapi test"', '"other"'), 2), { to: 'AD6DM' }, 'all')).rejects.toBeInstanceOf(ChangedOnNodeError);
  expect(posts(calls, 'MsgSave')).toEqual([]);
});

test('double-send guard: a kill whose MsgSave got the sign-in page is not resent after sign-in; the message is read again', async () => {
  let signedIn = true;
  const calls = node({
    '/Mail/Header': () => (signedIn ? HEADER : SIGNON),
    '/Mail/MsgDetails': () => (signedIn ? DETAILS2 : SIGNON),
    '/Mail/MsgSave': () => { signedIn = false; return SIGNON; },
  });
  const run = setStatus(held(), 'K');
  await vi.waitFor(() => expect(sysop.value).toBe('out'));
  signedIn = true;
  sysop.value = 'in';
  const out = await run;
  expect(out).toMatchObject({ interrupted: true, value: { id: 2, status: 'H' } });
  expect(posts(calls, 'MsgSave')).toHaveLength(1);
});

test('double-send guard: a lost mail key on the kill gets a fresh key and a re-read, not a second kill', async () => {
  let lost = true;
  const calls = node({
    '/Mail/Header': HEADER,
    '/Mail/MsgDetails': DETAILS2,
    '/Mail/MsgSave': () => { if (lost) { lost = false; return LOST; } return 'second kill'; },
  });
  const out = await setStatus(held(), 'K');
  expect(out.interrupted).toBe(true);
  expect(posts(calls, 'MsgSave')).toHaveLength(1);
  expect(sysop.value).toBe('in');
});

test('a sign-in asked for before the kill went out runs the whole job again after sign-in', async () => {
  let first = true;
  const calls = node({
    '/Mail/Header': HEADER,
    '/Mail/MsgDetails': () => { if (first) { first = false; return SIGNON; } return DETAILS2; },
    '/Mail/MsgSave': fixture('mail-msgsave-1-killed.html').replace('Message 1', 'Message 2'),
  });
  const run = setStatus(held(), 'K');
  await vi.waitFor(() => expect(sysop.value).toBe('out'));
  sysop.value = 'in';
  const out = await run;
  expect(out.interrupted).toBe(false);
  expect(posts(calls, 'MsgSave')).toHaveLength(1);
});

test('message text: MsgDetails then the EditM page, read as stored; too large a message is not read', async () => {
  const calls = node({ '/Mail/Header': HEADER, '/Mail/MsgDetails': DETAILS2, '/Mail/EditM': fixture('mail-editm-2.html') });
  expect(await readMessageText(2, 7)).toBe('hello\r\n');
  expect(calls.map((c) => c.path)).toEqual(['/Mail/Header', '/Mail/MsgDetails', '/Mail/EditM']);
  calls.length = 0;
  await expect(readMessageText(2, MAX_TEXT_BYTES + 1)).rejects.toThrow(/not read here/);
  expect(calls).toEqual([]);
  expect((await loadMessage(2)).subject).toBe('uiapi test');
});

test('forwarding step: partner list, the Msgs page (refreshes the node BBS list), MsgDetails, then MsgFwdUpdate once', async () => {
  const msg4 = fixture('mail-msgfwdupdate-4-queued.html').replace('#FFFF00;"onclick=ck("2")', '#FFFFFF;"onclick=ck("2")');
  const calls = node({
    '/Mail/Header': HEADER, '/Mail/FwdList.txt': fixture('mail-fwdlist.txt'), '/Mail/Msgs': 'msgs page',
    '/Mail/MsgDetails': msg4, '/Mail/MsgFwdUpdate': fixture('mail-msgfwdupdate-4-queued.html'),
  });
  const opened = parseMessageDetail(msg4, 4);
  const out = await stepForward(opened, 2);
  expect(out.value.fwd[1]).toEqual({ bbs: 2, call: 'RMS', state: 'queued' });
  expect(calls.map((c) => `${c.method} ${c.path} ${c.body}`)).toEqual([
    'GET /Mail/Header ', 'POST /Mail/FwdList.txt ', 'GET /Mail/Msgs ', 'POST /Mail/MsgDetails 4', 'POST /Mail/MsgFwdUpdate 2',
  ]);
});

test('forwarding step refuses a call that is not a forwarding partner and posts nothing that picks or changes', async () => {
  const msg4 = fixture('mail-msgfwdupdate-4-queued.html');
  const calls = node({ '/Mail/Header': HEADER, '/Mail/FwdList.txt': 'RMS|</body></html>', '/Mail/MsgFwdUpdate': 'x', '/Mail/MsgDetails': msg4 });
  await expect(stepForward(parseMessageDetail(msg4, 4), 1)).rejects.toThrow(/partner AD6DM/);
  expect(calls.filter((c) => c.path === '/Mail/MsgFwdUpdate' || c.path === '/Mail/MsgDetails')).toEqual([]);
});

test('Start Forwarding: partner list, FwdDetails, FWDSave "StartForward"; the reply is the partner record', async () => {
  const calls = node({
    '/Mail/Header': HEADER, '/Mail/FwdList.txt': fixture('mail-fwdlist.txt'),
    '/Mail/FwdDetails': fixture('mail-fwddetails-rms.html'), '/Mail/FWDSave': fixture('mail-fwdsave-startforward-rms.html'),
  });
  const out = await startForwarding('RMS');
  expect(out).toMatchObject({ interrupted: false, value: { call: 'RMS', queued: 0 } });
  expect(calls.map((c) => `${c.path} ${c.body}`)).toEqual(['/Mail/Header ', '/Mail/FwdList.txt ', '/Mail/FwdDetails RMS', '/Mail/FWDSave StartForward']);
});

test('Start Forwarding refuses a BBS user that is not a partner before any FwdDetails (it would crash the node)', async () => {
  const calls = node({ '/Mail/Header': HEADER, '/Mail/FwdList.txt': fixture('mail-fwdlist.txt'), '/Mail/FwdDetails': 'x', '/Mail/FWDSave': 'x' });
  await expect(startForwarding('N0CALL')).rejects.toThrow(/partner N0CALL/);
  expect(calls.filter((c) => c.path === '/Mail/FwdDetails' || c.path === '/Mail/FWDSave')).toEqual([]);
});

test('WP Delete: WPDetails, WPSave "Delete", then the list again, which no longer holds the call', async () => {
  let deleted = false;
  const calls = node({
    '/Mail/Header': HEADER,
    '/Mail/WPInfo.txt': () => (deleted ? 'N0CALL|</body></html>' : 'N0CALL|N1TEST|</body></html>'),
    '/Mail/WPDetails': (b) => fixture('mail-wpdetails-n0call.html').replace('value="N0CALL"', `value="${b}"`),
    '/Mail/WPSave': () => { deleted = true; return fixture('mail-wpdetails-n0call.html'); },
  });
  const out = await deleteRecord('wp', 'N1TEST');
  expect(out).toEqual({ interrupted: false, value: { calls: ['N0CALL'], gone: true } });
  expect(calls.map((c) => `${c.path} ${c.body}`)).toEqual([
    '/Mail/Header ', '/Mail/WPInfo.txt ', '/Mail/WPDetails N1TEST', '/Mail/WPSave Delete', '/Mail/WPInfo.txt ',
  ]);
});

test('WP Delete refuses the only record: the node then reads the freed record (seen on staging)', async () => {
  // The staging reply after deleting its only record: the call box holds freed memory.
  expect(fixture('mail-wpsave-delete.html')).not.toContain('N0CALL');
  expect(fixture('mail-wpinfo-after-delete.txt')).toBe('</body></html>');
  const calls = node({ '/Mail/Header': HEADER, '/Mail/WPInfo.txt': fixture('mail-wpinfo.txt'), '/Mail/WPSave': 'x', '/Mail/WPDetails': 'x' });
  await expect(deleteRecord('wp', 'N0CALL')).rejects.toBeInstanceOf(LastWpRecordError);
  expect(calls.filter((c) => c.path !== '/Mail/Header' && c.path !== '/Mail/WPInfo.txt')).toEqual([]);
});

test('double-send guard: a WP Delete that got the sign-in page is not resent; the list is read after sign-in', async () => {
  let signedIn = true;
  const calls = node({
    '/Mail/Header': () => (signedIn ? HEADER : SIGNON),
    '/Mail/WPInfo.txt': 'N0CALL|N1TEST|</body></html>',
    '/Mail/WPDetails': (b) => fixture('mail-wpdetails-n0call.html').replace('value="N0CALL"', `value="${b}"`),
    '/Mail/WPSave': () => { signedIn = false; return SIGNON; },
  });
  const run = deleteRecord('wp', 'N1TEST');
  await vi.waitFor(() => expect(sysop.value).toBe('out'));
  signedIn = true;
  sysop.value = 'in';
  expect(await run).toEqual({ interrupted: true, value: { calls: ['N0CALL', 'N1TEST'], gone: false } });
  expect(posts(calls, 'WPSave')).toHaveLength(1);
});
