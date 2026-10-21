import { render, screen, fireEvent, waitFor } from '@testing-library/preact';
import { SignIn } from '../SignIn';
import { sysop } from '../../data/session';
import { fixture, stubFetch } from '../../data/__tests__/helpers';

const USER = 'sysop';
const PASS = 'staging';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  sysop.value = 'unknown';
});

function spyEverywhere() {
  const stores = [vi.spyOn(Storage.prototype, 'setItem')];
  const logs = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
  return { stores, logs };
}

function fill(user: string, pass: string): void {
  fireEvent.input(screen.getByLabelText('User'), { target: { value: user } });
  fireEvent.input(screen.getByLabelText('Password'), { target: { value: pass } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

test('posts user and password, and writes neither to storage or the console', async () => {
  const spies = spyEverywhere();
  let sent = '';
  stubFetch({
    '/Node/Signon?Node': (init) => {
      sent = new TextDecoder().decode(init?.body as Uint8Array);
      return fixture('node-signon.html');
    },
  });
  render(<SignIn />);
  fill(USER, PASS);
  await waitFor(() => expect(sysop.value).toBe('in'));
  expect(sent).toBe(`user=${USER}&password=${PASS}`);
  for (const s of [...spies.stores, ...spies.logs]) {
    for (const call of s.mock.calls) expect(JSON.stringify(call)).not.toMatch(new RegExp(`${USER}|${PASS}`));
  }
  expect(spies.stores[0]).not.toHaveBeenCalled();
  expect(localStorage.length + sessionStorage.length).toBe(0);
  expect(location.hash + document.cookie).not.toContain(PASS);
});

test('a wrong password shows Sign-in failed and clears the password field', async () => {
  stubFetch({ '/Node/Signon?Node': '<form action=/Node/Signon?Node><input type=password name=password></form>' });
  render(<SignIn />);
  fill(USER, 'wrong');
  expect(await screen.findByRole('alert')).toHaveTextContent('Sign-in failed');
  expect(sysop.value).toBe('out');
  expect(screen.getByLabelText('Password')).toHaveValue('');
  expect(screen.getByLabelText('User')).toHaveValue(USER);
});

test('a node that does not answer also reads Sign-in failed, with the reason', async () => {
  stubFetch({});
  render(<SignIn />);
  fill(USER, PASS);
  expect(await screen.findByRole('alert')).toHaveTextContent(/Sign-in failed.*answered 404/);
});
