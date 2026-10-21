import { parseStats, parseRoutes, parseMailKey, parseLogList, parseLogText, logUrl } from '../pages';
import { ParseError } from '../http';
import { fixture } from './helpers';

test('parseStats reads the fork version and numeric counters from the staging page', () => {
  const s = parseStats(fixture('node-stats.html'));
  expect(s.version).toBe('6.0.26.1');
  expect(s.uptime).toMatch(/^\d+:\d+:\d+$/);
  expect(s.buffers).toEqual({ max: 999, cur: 999, min: 997, out: 0, wait: 0 });
  expect(s.maxNodes).toBe(250);
  expect(s.l4.framesTx).toBe(0);
  expect(s.l3Relayed).toBe(0);
});

test('parseStats without its table throws ParseError naming page and field', () => {
  const html = fixture('node-stats.html').replace(/<h2[\s\S]*$/, '');
  expect(() => parseStats(html)).toThrow(ParseError);
  try {
    parseStats(html);
  } catch (e) {
    expect((e as ParseError).page).toBe('Stats');
    expect((e as ParseError).field).toBe('Version');
    expect((e as Error).message).toBe('Could not read Version from Stats');
  }
});

test('parseRoutes: empty staging table gives no rows; missing table throws', () => {
  expect(parseRoutes(fixture('node-routes.html'))).toEqual([]);
  const html = fixture('node-routes.html').replace(/<h2[\s\S]*$/, '');
  expect(() => parseRoutes(html)).toThrow(/Could not read routes table from Routes/);
});

// Rows below follow RouteLine / RouteLineINP3 in HTTPcode.c; staging has no neighbours.
test('parseRoutes reads plain and INP3 rows', () => {
  const head = fixture('node-routes.html').replace(/<\/body><\/html>\s*$/, '');
  const rows =
    '<tr><td>&nbsp;2</td><td>N0CALL-1 </td><td>200</td><td>5</td><td>40</td><td>2</td><td>5%</td><td>4</td><td>3</td><td>12:30<td>1</td><td>180</td></td><td></td><td></td></tr>' +
    '<tr><td>&gt;3</td><td>N0CALL-2!!</td><td>255</td><td>9</td><td>0</td><td>0</td><td>0%</td><td>4</td><td>3</td><td>00:01</td><td>0</td><td>250</td><td>1.25s</td><td>0.50s</td></tr></table>';
  const r = parseRoutes(head + rows);
  expect(r).toHaveLength(2);
  expect(r[0]).toMatchObject({ port: 2, active: false, call: 'N0CALL-1', locked: '', quality: 200, percent: 5, srtt: null });
  expect(r[1]).toMatchObject({ port: 3, active: true, locked: '!!', lastHeard: '00:01', srtt: 1.25, remSrtt: 0.5 });
});

test('parseMailKey reads the key from menu links, null when absent', () => {
  expect(parseMailKey(fixture('mail-header.html'))).toMatch(/^M[0-9A-F]+$/);
  expect(parseMailKey(fixture('node-not-authorized.html'))).toBeNull();
});

test('parseLogList reads the View Logs buttons from the node menu', () => {
  const l = parseLogList(fixture('node-signon.html'));
  expect(l.map((f) => f.param)).toEqual(['NodeDebug', 'BBS', 'Debug', 'Telnet', 'CMS', 'Chat']);
  expect(logUrl(l[0]!, '2026-10-20')).toBe('/node/ShowLog.html?date=2026-10-20&NodeDebug=Node+Debug+Log');
  expect(() => parseLogList('<html></html>')).toThrow(ParseError);
});

test('parseLogText returns the textarea body', () => {
  expect(parseLogText('<textarea id=log name=Msg>line 1\nline 2</textarea>')).toBe('line 1\nline 2');
  expect(() => parseLogText('<p>x</p>')).toThrow(ParseError);
});
