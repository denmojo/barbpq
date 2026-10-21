import { parseForm, submitForm, encodeCfgSave, cfgSaveTooLarge, formPairs } from '../forms';
import { parseMailKey } from '../pages';
import { fixture, stubFetch } from './helpers';

const KEY = parseMailKey(fixture('mail-header.html'));
const KEY_CONF = `/Mail/Conf?${KEY}`;
const KEY_CFG = `/Mail/Config?${KEY}`;

afterEach(() => vi.unstubAllGlobals());

test('parseForm on the mail Conf page: action with session key and every named input', () => {
  const spec = parseForm(fixture('mail-conf.html'), 0, KEY_CONF);
  expect(spec.action).toBe(KEY_CFG);
  expect(spec.method).toBe('post');
  const by = (n: string) => spec.fields.find((f) => f.name === n);
  expect(by('BBSCall')).toMatchObject({ type: 'text', value: 'AD6DM' });
  expect(by('UserCantKillT')).toMatchObject({ type: 'checkbox', checked: true });
  expect(by('RefuseBulls')).toMatchObject({ type: 'checkbox', checked: false });
  expect(by('Save')?.type).toBe('submit');
  expect(spec.fields.filter((f) => f.name === 'Type' && f.type === 'radio')).toHaveLength(2);
  expect(spec.fields.length).toBeGreaterThan(60);
});

test('parseForm keeps hidden inputs, select options and textarea text', () => {
  const html =
    '<form method=post action="/x?K1"><input type=hidden name=h value="a b"><select name=s><option value=1>One<option value=2 selected>Two</select><textarea name=t>\nhello</textarea></form>';
  const spec = parseForm(html);
  expect(spec.fields).toEqual([
    { name: 'h', type: 'hidden', value: 'a b' },
    { name: 's', type: 'select', value: '2', options: [
      { value: '1', label: 'One', selected: false },
      { value: '2', label: 'Two', selected: true },
    ] },
    { name: 't', type: 'textarea', value: 'hello' },
  ]);
});

test('parseForm resolves the Edit Config relative action against its page', () => {
  const spec = parseForm(fixture('node-editcfg.html'), 0, '/Node/EditCfg.html');
  expect(spec.action).toMatch(/^\/Node\/CFGSave\?N[0-9A-F]+$/);
  expect(spec.fields.map((f) => f.name)).toEqual(['Msg', 'Save', 'Cancel']);
});

test('submitForm posts every field when one is edited', async () => {
  const spec = parseForm(fixture('mail-conf.html'), 0, KEY_CONF);
  let body = '';
  const calls = stubFetch({
    [KEY_CFG]: (init) => {
      body = new TextDecoder('latin1').decode(init?.body as Uint8Array);
      return '<html>ok</html>';
    },
  });
  const reply = await submitForm(spec, { Streams: '12', Save: 'Save' });
  expect(reply).toBe('<html>ok</html>');
  expect(calls[0]?.init?.method).toBe('POST');
  const sent = new URLSearchParams(body);
  expect(sent.get('Streams')).toBe('12');
  expect(sent.get('BBSCall')).toBe('AD6DM');
  expect(sent.get('ApplNum')).toBe('2');
  expect(sent.get('UserCantKillT')).toBe('on');
  expect(sent.has('RefuseBulls')).toBe(false);
  expect(sent.get('Save')).toBe('Save');
  expect(sent.has('Cancel')).toBe(false);
  expect(sent.get('Type')).toBe('TypeB');
  // every non-submit named field made it, edited or not
  const names = new Set(formPairs(spec, {}).map(([k]) => k));
  for (const f of spec.fields) {
    if (f.type === 'submit' || (f.type === 'checkbox' && !f.checked)) continue;
    if (f.type === 'radio' && !f.checked) continue;
    expect(names.has(f.name)).toBe(true);
  }
});

test('repeated names are addressed with name#index', () => {
  const spec = parseForm('<form action=/x><input name=From value=a><input name=From value=b></form>');
  expect(formPairs(spec, { 'From#1': 'z' })).toEqual([['From', 'a'], ['From', 'z']]);
});

test('submitForm throws when the node answers please sign in', async () => {
  const spec = parseForm('<form method=post action="/Node/CFGSave?N1"><input name=a value=1></form>');
  stubFetch({ '/Node/CFGSave?N1': '<b>Not authorizedxx - please sign in</b>' });
  await expect(submitForm(spec, {})).rejects.toThrow(/please sign in/);
});

test('encodeCfgSave: Msg= prefix, &Save= suffix, uppercase hex, plus for space, CR dropped', () => {
  const body = new TextDecoder('latin1').decode(encodeCfgSave('A B\r\nC=1&x%é'));
  expect(body).toBe('Msg=A+B%0AC%3D1%26x%25%E9&Save=');
});

test('cfgSaveTooLarge flags bodies over 99,000 bytes', () => {
  expect(cfgSaveTooLarge(new Uint8Array(99_000))).toBe(false);
  expect(cfgSaveTooLarge(new Uint8Array(99_001))).toBe(true);
  expect(cfgSaveTooLarge(encodeCfgSave('x'.repeat(98_000)))).toBe(false);
  expect(cfgSaveTooLarge(encodeCfgSave('\n'.repeat(40_000)))).toBe(true);
});
