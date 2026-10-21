// C1: a pick-then-save job never sends its write on a node session other than the one its pick
// went to. A fresh mail session has no current record, and MsgSave (ProcessMsgUpdate reads
// Msg->status, BBSHTMLConfig.c:2377), FWDSave (SaveFwdDetails reads USER->ForwardingInfo, :1936)
// and UserSave (ProcessUserUpdate) on it crash the node.
import { bytesOf, fixture } from '../../../data/__tests__/helpers';
import { currentMailKey, getProtected, signOut, sysop } from '../../../data/session';
import { fetchMailStatus, MailJobAbortedError } from '../../model';
import { deleteRecord, listRecords, saveRecord, startForwarding } from '../maildata';
import { parseMessageDetail, setStatus } from '../msgactions';
import { KEY } from './sample';

const B = 'M0000000000B1';
const C = 'M0000000000C2';
const header = (k: string) => fixture('mail-header.html').split(KEY).join(k);
const LOST = fixture('mail-lost.html');

interface Call { path: string; key: string; body: string }

/**
 * The node: /Mail/Header hands out the keys in `keys` in turn; `lost` keys answer every request
 * with the lost-session page. `hold` names a path whose first reply waits for release().
 */
function node(routes: Record<string, (body: string) => string>, opts: { keys: string[]; hold?: string }) {
  const calls: Call[] = [];
  const lost = new Set<string>();
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  let held = false;
  let picked!: () => void;
  const pickedNow = new Promise<void>((r) => { picked = r; });
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const raw = init?.body as Uint8Array | undefined;
    const body = raw ? Array.from(raw, (b) => String.fromCharCode(b)).join('') : '';
    const [path, key = ''] = url.split('?');
    if (path === '/Mail/Header') return new Response(bytesOf(header(opts.keys.shift() ?? C)), { status: 200 });
    calls.push({ path: path as string, key, body });
    if (lost.has(key)) return new Response(bytesOf(LOST), { status: 200 });
    if (path === opts.hold && !held) { held = true; picked(); await gate; }
    const hit = routes[path as string];
    return hit ? new Response(bytesOf(hit(body)), { status: 200 }) : new Response('nope', { status: 404 });
  });
  return { calls, lost, release, pickedNow };
}

const DETAILS2 = fixture('mail-msgdetails-2.html');
const writes = ['/Mail/MsgSave', '/Mail/FWDSave', '/Mail/UserSave', '/Mail/WPSave'];
const wrote = (calls: Call[]) => calls.filter((c) => writes.includes(c.path));
const wp = (b: string) => fixture('mail-wpdetails-n0call.html').replace('value="N0CALL"', `value="${b}"`);

const ROUTES: Record<string, (body: string) => string> = {
  '/Mail/MsgDetails': () => DETAILS2,
  '/Mail/MsgSave': () => fixture('mail-msgsave-2-released.html'),
  '/Mail/FwdList.txt': () => fixture('mail-fwdlist.txt'),
  '/Mail/FwdDetails': () => fixture('mail-fwddetails-rms.html'),
  '/Mail/FWDSave': () => fixture('mail-fwdsave-startforward-rms.html'),
  '/Mail/UserDetails': (b) => fixture('mail-userdetails-rms.html').replace('Update User RMS', `Update User ${b}`),
  '/Mail/UserSave': () => fixture('mail-userdetails-rms.html'),
  '/Mail/WPInfo.txt': () => 'N0CALL|N1TEST|</body></html>',
  '/Mail/WPDetails': wp,
  '/Mail/WPSave': () => wp('N0CALL'),
  '/Mail/Status': () => fixture('mail-status.html'),
};

beforeEach(() => { signOut(); sysop.value = 'in'; });
afterEach(() => { vi.unstubAllGlobals(); sysop.value = 'unknown'; });

const ACTIONS: [string, string, () => Promise<unknown>][] = [
  ['kill (MsgSave)', '/Mail/MsgDetails', () => setStatus(parseMessageDetail(DETAILS2, 2), 'K')],
  ['Start Forwarding (FWDSave)', '/Mail/FwdDetails', () => startForwarding('RMS')],
  ['forwarding record save (FWDSave)', '/Mail/FwdDetails', () => saveRecord('fwd', 'RMS', () => 'x|')],
  ['BBS user save (UserSave)', '/Mail/UserDetails', () => saveRecord('user', 'RMS', () => 'x|')],
  ['WP save (WPSave)', '/Mail/WPDetails', () => saveRecord('wp', 'N1TEST', () => 'x|')],
  ['WP Delete (WPSave)', '/Mail/WPDetails', () => deleteRecord('wp', 'N1TEST')],
];

test.each(ACTIONS)('%s: the session is lost and a fresh key handed out between the pick and the write; nothing is written on any key', async (_name, pickPath, run) => {
  const n = node(ROUTES, { keys: [B, C], hold: pickPath });
  const job = run();
  await n.pickedNow;                       // the pick is on its way, on key B
  n.lost.add(B);
  await fetchMailStatus();                 // the Status poll finds B lost, clears it, and gets C
  n.lost.delete(B);
  n.release();
  await expect(job).rejects.toBeInstanceOf(MailJobAbortedError);
  await expect(job).rejects.toThrow(/nothing more was sent\. Run it again\./);
  expect(wrote(n.calls)).toEqual([]);
  // Every request the job made carried B; the Status retry alone used C.
  expect(n.calls.filter((c) => c.key === C).map((c) => c.path)).toEqual(['/Mail/Status']);
  expect(sysop.value).toBe('in');
});

test.each(ACTIONS)('%s: a lost-session reply to the pick itself aborts the job; it is not run again on a fresh key', async (_name, pickPath, run) => {
  const n = node(ROUTES, { keys: [B, C] });
  n.lost.add(B);
  await expect(run()).rejects.toBeInstanceOf(MailJobAbortedError);
  expect(wrote(n.calls)).toEqual([]);
  expect(n.calls.some((c) => c.key === C)).toBe(false);
  expect(n.calls.filter((c) => c.path === pickPath || c.path === '/Mail/FwdList.txt' || c.path === '/Mail/WPInfo.txt').length).toBeGreaterThan(0);
});

test('a late lost reply to a request on an older key does not clear the newer key; the job writes once, on its own key', async () => {
  const A = 'M0000000000A0';
  const n = node(ROUTES, { keys: [B], hold: '/Mail/MsgDetails' });
  const job = setStatus(parseMessageDetail(DETAILS2, 2), 'N');
  await n.pickedNow;
  n.lost.add(A);
  await expect(getProtected(`/Mail/Status?${A}`)).rejects.toThrow(/dropped this mail session/);
  n.release();
  await expect(job).resolves.toMatchObject({ interrupted: false, value: { status: 'N' } });
  expect(wrote(n.calls).map((c) => `${c.path} ${c.key}`)).toEqual([`/Mail/MsgSave ${B}`]);
});

test('after an abort, running the action again starts from the pick on the fresh key', async () => {
  const n = node(ROUTES, { keys: [B, C] });
  n.lost.add(B);
  const opened = parseMessageDetail(DETAILS2, 2);
  await expect(setStatus(opened, 'N')).rejects.toBeInstanceOf(MailJobAbortedError);
  await expect(setStatus(opened, 'N')).resolves.toMatchObject({ value: { status: 'N' } });
  expect(n.calls.filter((c) => c.key === C).map((c) => c.path)).toEqual(['/Mail/MsgDetails', '/Mail/MsgSave']);
});

// N1: the write had its reply, then the read-back found the session gone.
test('a delete that was answered, then loses the session on the read-back, says it was sent and answered and the view needs a reload', async () => {
  const n: ReturnType<typeof node> = node({
    ...ROUTES,
    '/Mail/UserSave': () => { n.lost.add(B); return 'deleted'; },
  }, { keys: [B, C] });
  const err = await deleteRecord('user', 'RMS').catch((e: unknown) => e);
  expect(err).toBeInstanceOf(Error);
  expect((err as Error).message).toMatch(/sent and the node answered/);
  expect((err as Error).message).toMatch(/[Rr]eload/);
  expect((err as Error).message).not.toMatch(/nothing more was sent/);
  expect(wrote(n.calls)).toHaveLength(1);
});

// N2: a late lost reply on an old key must not clear a newer cached key.
test('the WP list GET: a late lost reply on an old key leaves the newer key cached', async () => {
  let headers = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  let listed = false;
  let atList!: () => void;
  const listing = new Promise<void>((r) => { atList = r; });
  const lostKeys = new Set<string>();
  vi.stubGlobal('fetch', async (url: string) => {
    const [path, key = ''] = url.split('?');
    if (path === '/Mail/Header') { headers += 1; return new Response(bytesOf(header(headers === 1 ? B : C)), { status: 200 }); }
    if (lostKeys.has(key)) return new Response(bytesOf(LOST), { status: 200 });
    if (path === '/Mail/WPInfo.txt' && key === B && !listed) { listed = true; atList(); await gate; return new Response(bytesOf(LOST), { status: 200 }); }
    if (path === '/Mail/WPInfo.txt') return new Response('N0CALL|N1TEST|', { status: 200 });
    return new Response(bytesOf(fixture('mail-status.html')), { status: 200 });
  });
  const list = listRecords('wp');
  await listing;
  lostKeys.add(B);
  await fetchMailStatus();                // finds B lost, clears it, gets C
  release();
  await expect(list).resolves.toEqual(['N0CALL', 'N1TEST']);
  expect(headers).toBe(2);
  expect(currentMailKey()).toBe(C);
});
