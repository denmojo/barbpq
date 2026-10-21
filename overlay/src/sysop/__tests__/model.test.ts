process.env.TZ = 'America/Los_Angeles';

import { fixture } from '../../data/__tests__/helpers';
import type { UiEvent } from '../../data/uiapi';
import {
  eventTime, parseConnectScript, parseFwdDetails, parseFwdList, parseMailStatus, portLabel, scheduleNote,
  shortAddr, storeForward, EVENT_WINDOW, type Forwarding, type FwdRecord,
} from '../model';
import { station } from '../../public/__tests__/sample';

const rms = (over: Partial<FwdRecord> = {}): Forwarding => ({
  partners: ['AD6DM', 'RMS'],
  rms: { call: 'RMS', enabled: true, script: 'C CMS', intervalSec: 1800, sendAtOnce: true, queued: 0, ...over },
});
const ev = (t: string, kind: UiEvent['kind'], detail: Record<string, unknown> = {}): UiEvent => ({ t, kind, detail });

test('parseMailStatus reads the BBS call, active streams and the four counters', () => {
  expect(parseMailStatus(fixture('mail-status.html'))).toEqual({ bbs: 'AD6DM', users: 0, msgs: 4, sysopMsgs: 3, held: 1, smtp: 0 });
});

test('parseMailStatus counts every stream that is not Idle', () => {
  const html = fixture('mail-status.html').replace('<option value=2>Idle', '<option value=2>Sysop&nbsp;&nbsp;N0CALL').replace('<option value=5>Idle', '<option value=5>Logging in');
  expect(parseMailStatus(html).users).toBe(2);
});

test('parseMailStatus names the missing counter', () => {
  expect(() => parseMailStatus(fixture('mail-status.html').replace('Held Msgs', 'Kept'))).toThrow(/Held Msgs from Mail Status/);
});

test('parseFwdList drops the trailing tags after the last bar', () => {
  expect(parseFwdList(fixture('mail-fwdlist.txt'))).toEqual(['AD6DM', 'RMS']);
});

test('parseFwdDetails reads the RMS record from its forwarding form', () => {
  const r = parseFwdDetails(fixture('mail-fwddetails-rms.html'), 'RMS');
  expect(r).toMatchObject({ call: 'RMS', enabled: true, intervalSec: 1800, sendAtOnce: true, queued: 0 });
  expect(r.script.split('\n').filter(Boolean)).toEqual(['ATTACH 1', 'NOFALLBACK', 'C CMS', 'ELSE', 'C 2 W6SAR-10']);
  const off = parseFwdDetails(fixture('mail-fwddetails-rms.html').replace('checked=checked name=EnF', 'name=EnF'), 'RMS');
  expect(off.enabled).toBe(false);
});

test('connect script ATTACH 1|NOFALLBACK|C CMS|ELSE|C 2 W6SAR-10 is CMS via internet, then W6SAR-10 on port 2', () => {
  const steps = parseConnectScript('ATTACH 1|NOFALLBACK|C CMS|ELSE|C 2 W6SAR-10');
  expect(steps).toEqual([
    { kind: 'cms', label: 'CMS via internet', port: 1 },
    { kind: 'call', label: 'W6SAR-10', port: 2 },
  ]);
  expect(parseConnectScript('ATTACH 1\nNOFALLBACK\nC CMS\nELSE\nC 2 W6SAR-10\n')).toEqual(steps);
  expect(steps.map((s) => portLabel(s.port, station.ports))).toEqual(['Telnet port 1', 'Packet port 2']);
});

test('connect script: a bare connect is routed by the node; only the first connect of each try counts', () => {
  expect(parseConnectScript('C W6SAR-10|C AD6DM-10|ELSE|PAUSE 5|CONNECT 3 N0CALL')).toEqual([
    { kind: 'call', label: 'W6SAR-10', port: null },
    { kind: 'call', label: 'N0CALL', port: 3 },
  ]);
  expect(portLabel(null, station.ports)).toBe('Routed by the node');
  expect(portLabel(3, station.ports)).toBe('VARA port 3');
  expect(parseConnectScript('NOFALLBACK')).toEqual([]);
});

test('store and forward: Armed and Last used from the newest forward with the CMS unreachable', () => {
  const events = [
    ev('2026-10-20T16:58:00Z', 'forward', { route: 'RMS via port 1', cmsReachable: true }),
    ev('2026-10-20T16:50:00Z', 'forward', { route: 'RMS via port 1', cmsReachable: false }),
    ev('2026-10-19T12:00:00Z', 'forward', { route: 'RMS via port 1', cmsReachable: false }),
  ];
  expect(storeForward(rms(), events)).toEqual({ tone: 'ok', value: 'Armed', meta: 'Last used Oct 20 09:50' });
});

test('store and forward: Never used without such an event; Off when the record is disabled; no record', () => {
  expect(storeForward(rms(), [ev('2026-10-20T16:58:00Z', 'forward', { cmsReachable: true }), ev('2026-10-20T16:00:00Z', 'restart')]))
    .toEqual({ tone: 'warn', value: 'Armed', meta: 'Never used' });
  expect(storeForward(rms({ enabled: false }), [])).toMatchObject({ tone: 'down', value: 'Off', meta: 'Never used' });
  expect(storeForward({ partners: [], rms: null }, [])).toMatchObject({ value: 'Not set up' });
});

test('schedule note and short addresses', () => {
  expect(scheduleNote(rms().rms!)).toBe('Every 30 min while mail is held · sends new mail at once');
  expect(scheduleNote(rms({ intervalSec: 0, sendAtOnce: false }).rms!)).toBe('');
  expect(shortAddr('127.0.0.1:8300')).toBe(':8300');
  expect(shortAddr('10.0.0.5:8300')).toBe('10.0.0.5:8300');
  expect(shortAddr(null)).toBeNull();
});

test('eventTime: clock time today, the date before today (local zone)', () => {
  const now = new Date('2026-10-20T17:00:00Z');
  expect(eventTime('2026-10-20T15:12:00Z', now)).toBe('08:12');
  expect(eventTime('2026-10-20T06:00:00Z', now)).toBe('Oct 19');
});

test('store and forward: no fallback in a full 200-event window is Unknown, not Never used', () => {
  expect(EVENT_WINDOW).toBe(200);
  const full = Array.from({ length: EVENT_WINDOW }, (_, i) => ev(new Date(Date.UTC(2026, 9, 20, 16, 0, 0) - i * 60_000).toISOString(), 'restart'));
  expect(storeForward(rms(), full)).toEqual({
    tone: 'warn', value: 'Armed', meta: '', metaUnknown: 'No fallback in the last 200 events',
  });
});

test('store and forward: no fallback in a log shorter than the window is Never used', () => {
  const short = Array.from({ length: EVENT_WINDOW - 1 }, () => ev('2026-10-20T16:00:00Z', 'restart'));
  expect(storeForward(rms(), short)).toEqual({ tone: 'warn', value: 'Armed', meta: 'Never used' });
});

// N2: the node logs a forward event for a run to any partner, and the CMS result a run takes
// can come from someone else's attempt. Only runs to the RMS record count.
test('store and forward: a fallback logged for a run to another partner is not the RMS fallback', () => {
  const events = [
    ev('2026-10-20T16:50:00Z', 'forward', { route: 'AD6DM via port 2', cmsReachable: false }),
    ev('2026-10-20T16:40:00Z', 'forward', { route: 'RMSX', cmsReachable: false }),
    ev('2026-10-20T16:30:00Z', 'forward', { cmsReachable: false }),
  ];
  expect(storeForward(rms(), events)).toEqual({ tone: 'warn', value: 'Armed', meta: 'Never used' });
  const withRms = [...events, ev('2026-10-19T12:00:00Z', 'forward', { route: 'rms', cmsReachable: false })];
  expect(storeForward(rms(), withRms)).toMatchObject({ tone: 'ok', meta: 'Last used Oct 19 05:00' });
});

// N1: a run whose CMS result did not come within the node's wait is logged with cmsReachable null.
test('store and forward: an RMS run with no CMS result makes Never used Unknown, with the reason', () => {
  const events = [
    ev('2026-10-20T16:58:00Z', 'forward', { route: 'RMS via port 1', cmsReachable: true }),
    ev('2026-10-20T16:50:00Z', 'forward', { route: 'RMS via port 1', cmsReachable: null }),
  ];
  const sf = storeForward(rms(), events);
  expect(sf).toMatchObject({ tone: 'warn', value: 'Armed', meta: '' });
  expect(sf.metaUnknown).toBe('The RMS run at Oct 20 09:50 logged no CMS result within the node\'s wait, so whether it fell back is not known');
});

test('store and forward: an unknown RMS run newer than the last fallback makes Last used Unknown', () => {
  const events = [
    ev('2026-10-20T16:50:00Z', 'forward', { route: 'RMS via port 1', cmsReachable: null }),
    ev('2026-10-19T12:00:00Z', 'forward', { route: 'RMS via port 1', cmsReachable: false }),
  ];
  expect(storeForward(rms(), events)).toMatchObject({ tone: 'ok', meta: '', metaUnknown: expect.stringContaining('Oct 20 09:50') });
});

test('store and forward: a later fallback supersedes an unknown run; an older unknown run, or one to another partner, changes nothing', () => {
  expect(storeForward(rms(), [
    ev('2026-10-20T16:58:00Z', 'forward', { route: 'RMS via port 1', cmsReachable: false }),
    ev('2026-10-20T16:50:00Z', 'forward', { route: 'RMS via port 1', cmsReachable: null }),
  ])).toEqual({ tone: 'ok', value: 'Armed', meta: 'Last used Oct 20 09:58' });
  expect(storeForward(rms(), [
    ev('2026-10-20T16:58:00Z', 'forward', { route: 'AD6DM via port 2', cmsReachable: null }),
  ])).toEqual({ tone: 'warn', value: 'Armed', meta: 'Never used' });
});

test('store and forward: Off still carries the unknown last-used line', () => {
  const events = [ev('2026-10-20T16:50:00Z', 'forward', { route: 'RMS', cmsReachable: null })];
  expect(storeForward(rms({ enabled: false }), events)).toMatchObject({ tone: 'down', value: 'Off', meta: '', metaUnknown: expect.any(String) });
});
