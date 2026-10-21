import { listApplications, listPorts, listUsers, setApplication, setTxtail, setUser } from '../cfgforms';
import { CMS_PASSWORD, SAMPLE_CFG, USER_PASSWORD } from './sample';

/** Line numbers (1-based) where two texts differ; both must have the same line count. */
function changedLines(a: string, b: string): number[] {
  const x = a.split('\n');
  const y = b.split('\n');
  expect(y).toHaveLength(x.length);
  return x.flatMap((l, i) => (l === y[i] ? [] : [i + 1]));
}
const lineOf = (text: string, s: string) => text.split('\n').indexOf(s) + 1;

test('listPorts reads each PORT block: number, ID, driver or protocol, TXTAIL', () => {
  expect(listPorts(SAMPLE_CFG).map(({ number, id, driver, txtail }) => ({ number, id, driver, txtail }))).toEqual([
    { number: 1, id: 'Telnet Server', driver: 'TELNET', txtail: null },
    { number: 3, id: 'VARA FM', driver: 'VARA', txtail: null },
    { number: 2, id: 'Direwolf', driver: 'KISS', txtail: 50 },
  ]);
});

test('setTxtail(text, 2, 100) changes only port 2\'s TXTAIL= line and keeps its comment', () => {
  const out = setTxtail(SAMPLE_CFG, 2, 100);
  expect(changedLines(SAMPLE_CFG, out)).toEqual([lineOf(SAMPLE_CFG, ' TXTAIL=50 ; tail')]);
  expect(out).toContain('\n TXTAIL=100 ; tail\n');
});

test('setTxtail adds a TXTAIL line after PORTNUM when the port has none, never inside CONFIG text', () => {
  const out = setTxtail(SAMPLE_CFG, 3, 30);
  const lines = out.split('\n');
  const at = lines.indexOf(' PORTNUM=3');
  expect(lines[at + 1]).toBe(' TXTAIL=30');
  expect(lines).toHaveLength(SAMPLE_CFG.split('\n').length + 1);
});

test('setTxtail keeps CRLF line ends', () => {
  const crlf = 'NODECALL=N0CALL\r\nPORT\r\n PORTNUM=2\r\n TXTAIL=100\r\nENDPORT\r\n';
  expect(setTxtail(crlf, 2, 110)).toBe('NODECALL=N0CALL\r\nPORT\r\n PORTNUM=2\r\n TXTAIL=110\r\nENDPORT\r\n');
});

test('setTxtail refuses a port that is not in the file and a value that is not a whole number', () => {
  expect(() => setTxtail(SAMPLE_CFG, 9, 100)).toThrow(/No PORT block with PORTNUM=9/);
  expect(() => setTxtail(SAMPLE_CFG, 2, -1)).toThrow(/whole number/);
  expect(() => setTxtail(SAMPLE_CFG, 2, 1.5)).toThrow(/whole number/);
});

test('ports without PORTNUM take their place in the file as their number', () => {
  const text = 'PORT\n ID=A\nENDPORT\nPORT\n ID=B\n TXTAIL=5\nENDPORT\n';
  expect(listPorts(text).map((p) => [p.number, p.id])).toEqual([[1, 'A'], [2, 'B']]);
  expect(setTxtail(text, 2, 6)).toBe('PORT\n ID=A\nENDPORT\nPORT\n ID=B\n TXTAIL=6\nENDPORT\n');
});

test('listApplications reads APPLICATION lines', () => {
  expect(listApplications(SAMPLE_CFG)).toEqual([
    { number: 1, command: 'RMS', cmdAlias: 'C 1 CMS', call: 'AD6DM-10', alias: '', quality: '0', l2alias: '' },
    { number: 2, command: 'BBS', cmdAlias: '', call: '', alias: '', quality: '', l2alias: '' },
  ]);
});

test('setApplication rewrites one line, unchanged fields stay byte for byte, and appends a new number', () => {
  const [rms, bbs] = listApplications(SAMPLE_CFG);
  expect(setApplication(SAMPLE_CFG, rms!)).toBe(SAMPLE_CFG);
  const out = setApplication(SAMPLE_CFG, { ...bbs!, call: 'AD6DM-1', alias: 'EGBBS' });
  expect(changedLines(SAMPLE_CFG, out)).toEqual([lineOf(SAMPLE_CFG, 'APPLICATION 2,BBS')]);
  expect(out).toContain('\nAPPLICATION 2,BBS,,AD6DM-1,EGBBS\n');
  const added = setApplication(SAMPLE_CFG, { number: 3, command: 'CHAT', cmdAlias: '', call: '', alias: '', quality: '', l2alias: '' });
  expect(added).toContain('APPLICATION 2,BBS\nAPPLICATION 3,CHAT\n');
  expect(() => setApplication(SAMPLE_CFG, { ...bbs!, command: 'A,B' })).toThrow(/comma/);
});

test('listUsers never returns a password', () => {
  const users = listUsers(SAMPLE_CFG);
  expect(users).toEqual([
    { port: 1, user: 'sysop', password: null, call: 'N0CALL', appl: '', sysop: true },
    { port: 1, user: 'guest', password: null, call: 'KX6ABC', appl: 'BBS', sysop: false },
  ]);
  const json = JSON.stringify(users);
  expect(json).not.toContain(USER_PASSWORD);
  expect(json).not.toContain(CMS_PASSWORD);
});

test('setUser keeps the stored password unless a new one is given', () => {
  const [sysop] = listUsers(SAMPLE_CFG);
  const kept = setUser(SAMPLE_CFG, { ...sysop!, call: 'AD6DM' });
  expect(kept).toContain(`\n USER=sysop,${USER_PASSWORD},AD6DM,,SYSOP\n`);
  expect(changedLines(SAMPLE_CFG, kept)).toHaveLength(1);
  expect(setUser(SAMPLE_CFG, sysop!)).toBe(SAMPLE_CFG);
  const changed = setUser(SAMPLE_CFG, sysop!, 'n3wpass');
  expect(changed).toContain('\n USER=sysop,n3wpass,N0CALL,,SYSOP\n');
});

test('setUser adds a new user after the last USER line of its port, and needs a password for it', () => {
  const rec = { port: 1, user: 'kid', password: null, call: 'kk6xyz', appl: '', sysop: false };
  expect(() => setUser(SAMPLE_CFG, rec)).toThrow(/needs a password/);
  const out = setUser(SAMPLE_CFG, rec, 'pw1');
  expect(out).toContain(`USER=guest,${USER_PASSWORD}g,KX6ABC,BBS\n USER=kid,pw1,KK6XYZ\n CTEXT=Welcome.`);
  expect(() => setUser(SAMPLE_CFG, rec, 'a,b')).toThrow(/comma/);
  expect(() => setUser(SAMPLE_CFG, rec, 'a b')).toThrow(/space/);
  expect(() => setUser(SAMPLE_CFG, { ...rec, port: 2 }, 'pw1')).toThrow(/Telnet/);
});
