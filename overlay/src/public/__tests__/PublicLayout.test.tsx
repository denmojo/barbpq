import { render, screen, fireEvent, waitFor } from '@testing-library/preact';
import { PublicLayout } from '../PublicLayout';
import { route } from '../../app/router';
import { themeMode } from '../../ui/theme';
import { expectNoOldPageLinks, prime } from './prime';

vi.mock('../../data/api', async () => (await import('./mocks')).MOCK_API());
vi.mock('../../data/uiapi', async () => (await import('./mocks')).MOCK_UI());
vi.mock('../../data/pages', async () => (await import('./mocks')).MOCK_PAGES());

beforeEach(() => {
  prime();
  location.hash = '#/overview';
  route.value = 'overview';
});

test('header shows the node call, alias and locator, five tabs and the three controls', async () => {
  const { container } = render(<PublicLayout />);
  const header = container.querySelector('header')!;
  expect(await screen.findByText('AD6DM-11', { selector: '.brand-name' })).toBeInTheDocument();
  expect(screen.getByText('EGNOD · CM98hj')).toBeInTheDocument();
  const tabs = Array.from(header.querySelectorAll('nav a')).map((a) => [a.textContent, a.getAttribute('href')]);
  expect(tabs).toEqual([
    ['Overview', '#/overview'], ['Ports', '#/ports'], ['Heard', '#/heard'],
    ['Links & routes', '#/links'], ['Sessions', '#/sessions'],
  ]);
  expect(header.querySelector('nav a[aria-current="page"]')?.textContent).toBe('Overview');
  expect(screen.getByRole('button', { name: /Switch theme/ })).toBeInTheDocument();
  const webmail = screen.getByRole('button', { name: /Webmail/ });
  const signin = screen.getByRole('button', { name: /SysOp sign in/ });
  expect(webmail).toHaveClass('btn');
  expect(webmail).not.toHaveClass('primary');
  expect(signin).toHaveClass('btn', 'primary');
});

test('Webmail is disabled with the coming-soon tooltip and links nowhere', async () => {
  const { container } = render(<PublicLayout />);
  await screen.findByText('EGNOD · CM98hj');
  const webmail = screen.getByRole('button', { name: /Webmail/ });
  expect(webmail).toBeDisabled();
  expect(webmail).toHaveAttribute('title', 'Coming in the next release');
  expect(webmail.closest('a')).toBeNull();
  expectNoOldPageLinks(container);
});

test('SysOp sign in goes to the sign-in route of the new UI', async () => {
  render(<PublicLayout />);
  fireEvent.click(await screen.findByRole('button', { name: /SysOp sign in/ }));
  expect(route.value).toBe('health');
  expect(location.hash).toBe('#/health');
});

test('the theme toggle switches to the opposite of the system theme and back', () => {
  themeMode.value = 'system';
  render(<PublicLayout />);
  fireEvent.click(screen.getByRole('button', { name: /Switch theme/ }));
  expect(themeMode.value).toBe('opposite');
  fireEvent.click(screen.getByRole('button', { name: /Switch theme/ }));
  expect(themeMode.value).toBe('system');
});

test('the theme toggle reports its state: aria-pressed in opposite mode, the current theme in its name', () => {
  themeMode.value = 'system';
  render(<PublicLayout />);
  const btn = screen.getByRole('button', { name: /Switch theme/ });
  expect(btn).toHaveAttribute('aria-pressed', 'false');
  expect(btn).toHaveAccessibleName('Switch theme (now light)');
  fireEvent.click(btn);
  expect(btn).toHaveAttribute('aria-pressed', 'true');
  expect(btn).toHaveAccessibleName('Switch theme (now dark)');
  themeMode.value = 'system';
});

test('document title is the node call and the public name', async () => {
  render(<PublicLayout />);
  await waitFor(() => expect(document.title).toBe('AD6DM-11 · BarBPQ - LinBPQ Web UI'));
});

test('the active tab follows the route', async () => {
  route.value = 'heard';
  const { container } = render(<PublicLayout />);
  await screen.findByText('EGNOD · CM98hj');
  expect(container.querySelector('nav a[aria-current="page"]')?.textContent).toBe('Heard');
});
