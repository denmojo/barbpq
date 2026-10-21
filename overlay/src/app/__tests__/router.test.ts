import { route, navigate, syncRoute, parseHash } from '../router';

test('#/ports sets route to ports', () => {
  location.hash = '#/ports';
  syncRoute();
  expect(route.value).toBe('ports');
});

test('unknown hash falls back to overview', () => {
  location.hash = '#/nonsense';
  syncRoute();
  expect(route.value).toBe('overview');
  expect(parseHash('')).toBe('overview');
});

test('navigate updates hash and route', () => {
  navigate('logs');
  expect(location.hash).toBe('#/logs');
  expect(route.value).toBe('logs');
});
