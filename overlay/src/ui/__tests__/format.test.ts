process.env.TZ = 'America/Los_Angeles';

import { formatAgo, formatClock, formatFreq, formatUptime, modeName } from '../format';

test('frequency in MHz to three places', () => {
  expect(formatFreq(145630000)).toBe('145.630 MHz');
  expect(formatFreq(14105000)).toBe('14.105 MHz');
});

test('uptime as days and hh:mm', () => {
  expect(formatUptime(2 * 86400 + 4 * 3600 + 17 * 60 + 59)).toBe('2d 04:17');
  expect(formatUptime(529)).toBe('0d 00:08');
});

test('local clock time from an ISO stamp', () => {
  expect(formatClock('2026-10-20T16:12:00Z')).toBe('09:12');
  expect(formatClock(new Date('2026-10-20T23:05:00Z'))).toBe('16:05');
});

test('age in the largest whole unit', () => {
  const now = new Date('2026-10-20T17:00:00Z');
  expect(formatAgo('2026-10-20T16:59:40Z', now)).toBe('now');
  expect(formatAgo('2026-10-20T16:56:00Z', now)).toBe('4m');
  expect(formatAgo('2026-10-20T14:00:00Z', now)).toBe('3h');
  expect(formatAgo('2026-10-17T17:00:00Z', now)).toBe('3d');
});

test('Winlink mode codes read as words, unknown codes pass through', () => {
  expect(modeName('VARAFM96')).toBe('VARA FM');
  expect(modeName('PKT1200')).toBe('1200 baud packet');
  expect(modeName('XYZ')).toBe('XYZ');
});
