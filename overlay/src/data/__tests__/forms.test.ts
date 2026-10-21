import { parseForm, submitForm, encodeCfgSave, cfgSaveTooLarge, formPairs, encodePairs, saveConfig, CfgTooLargeError, extractConfigText, SaveFailedError } from '../forms';
import { decodeLatin1, encodeLatin1Form, NonLatin1Error, latin1Bytes } from '../http';
import { currentMailKey, mailKey, signOut, sysop } from '../session';
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

test('encodeCfgSave: Msg= prefix, &Save=Save suffix, uppercase hex, plus for space, CR dropped', () => {
  const body = new TextDecoder('latin1').decode(encodeCfgSave('A B\r\nC=1&x%é'));
  expect(body).toBe('Msg=A+B%0AC%3D1%26x%25%E9&Save=Save');
});

test('cfgSaveTooLarge flags bodies over 99,000 bytes', () => {
  expect(cfgSaveTooLarge(new Uint8Array(99_000))).toBe(false);
  expect(cfgSaveTooLarge(new Uint8Array(99_001))).toBe(true);
  expect(cfgSaveTooLarge(encodeCfgSave('x'.repeat(98_000)))).toBe(false);
  expect(cfgSaveTooLarge(encodeCfgSave('\n'.repeat(40_000)))).toBe(true);
});

/** The node's decoder (HTTPcode.c): uppercase %XX only, + is space, CR stripped. */
function nodeDecode(body: Uint8Array): Uint8Array {
  const s = new TextDecoder('latin1').decode(body); // ASCII only here
  const msg = s.slice(4, s.indexOf('&Save='));
  const out: number[] = [];
  for (let i = 0; i < msg.length; i++) {
    let c = msg.charCodeAt(i);
    if (c === 0x25) {
      let m = msg.charCodeAt(++i) - 48; if (m > 9) m -= 7;
      let n = msg.charCodeAt(++i) - 48; if (n > 9) n -= 7;
      c = m * 16 + n;
    } else if (c === 0x2b) c = 0x20;
    if (c !== 13) out.push(c);
  }
  return Uint8Array.from(out);
}

test('every byte 0x01-0xFF (no CR) survives decode, textarea, encodeCfgSave and the node decoder', () => {
  const raw: number[] = [];
  for (let b = 0; b < 256; b++) if (b !== 13 && b !== 0) raw.push(b);
  // NUL is left out: an HTML parser turns it into U+FFFD, and the node's C string would end there.
  const wire = Uint8Array.from([...Array.from(raw)]);
  const decoded = decodeLatin1(wire.buffer);
  expect(decoded.charCodeAt(raw.indexOf(0x80))).toBe(0x80);
  const page = `<form method=post action=x><textarea name=Msg>X${decoded}</textarea></form>`;
  const text = parseForm(page).fields[0]!.value.slice(1);
  expect(Array.from(latin1Bytes(text))).toEqual(raw);
  expect(Array.from(nodeDecode(encodeCfgSave(text)))).toEqual(raw);
});

test('encodeCfgSave round-trips tab, degree sign, + % & =, CRLF and a trailing newline', () => {
  const text = 'a\tb\u00b0c+d%e&f=g\r\nline2\n';
  const out = nodeDecode(encodeCfgSave(text));
  expect(new TextDecoder('latin1').decode(out)).toBe('a\tb\u00b0c+d%e&f=g\nline2\n');
});

test('a character above U+00FF throws NonLatin1Error with its position', () => {
  expect(() => encodeLatin1Form('ab\u20acd')).toThrow(NonLatin1Error);
  try { encodeCfgSave('ab\u20acd'); } catch (e) {
    expect((e as NonLatin1Error).position).toBe(2);
    expect((e as Error).message).toMatch(/position 2/);
  }
});

test('saveConfig refuses over 99,000 bytes before any request', async () => {
  const calls = stubFetch({});
  const err = await saveConfig('\n'.repeat(40_000)).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(CfgTooLargeError);
  expect((err as CfgTooLargeError).bytes).toBeGreaterThan(99_000);
  expect(calls).toHaveLength(0);
  // 99,001 exactly
  const text = 'x'.repeat(99_001 - 'Msg='.length - '&Save=Save'.length);
  expect(encodeCfgSave(text).length).toBe(99_001);
  await expect(saveConfig(text)).rejects.toBeInstanceOf(CfgTooLargeError);
  expect(calls).toHaveLength(0);
});

test('saveConfig reads the form action then posts the body, retrying after sign-in', async () => {
  let posted: Uint8Array | undefined;
  let first = true;
  stubFetch({
    '/Node/EditCfg.html': () => (first ? (first = false, '<b>Not authorized - please sign in</b>') : '<form method=post action=CFGSave?N1><textarea name=Msg></textarea></form>'),
    '/Node/CFGSave?N1': (init) => { posted = init?.body as Uint8Array; return '<html><script>alert("Configuration Saved, Orig Length 10 New Length 16");window.close();</script></html>'; },
    '/Node/Signon?Node': fixture('node-signon.html'),
  });
  const p = saveConfig('A B\n');
  await vi.waitFor(() => expect(sysop.value).toBe('out'));
  const { signIn } = await import('../session');
  await signIn('sysop', 'staging');
  await p;
  expect(new TextDecoder('latin1').decode(posted)).toBe('Msg=A+B%0A&Save=Save');
  sysop.value = 'unknown';
});

test('config text with entities, leading blank line and a literal </textarea> round-trips exactly', () => {
  const cfg = '\n; a &amp; b &lt;b&gt; &#65; &#x41;\nREM </textarea> still config\nPORT\n';
  const page = `<html><body><form method=post action=CFGSave?N1\n\n><textarea cols=100 rows=25 name=Msg>${cfg}</textarea><br><input name=Save value=Save type=submit></form></body></html>`;
  const text = extractConfigText(page);
  expect(text).toBe(cfg);
  expect(new TextDecoder('latin1').decode(nodeDecode(encodeCfgSave(text)))).toBe(cfg);
  expect(() => extractConfigText('<p>none</p>')).toThrow(/config text/);
});

test('saveConfig throws SaveFailedError when the reply lacks the confirmation', async () => {
  const page = '<form method=post action=CFGSave?N1><textarea name=Msg></textarea></form>';
  stubFetch({
    '/Node/EditCfg.html': page,
    '/Node/CFGSave?N1': '<html><script>alert("Failed to write Config File");window.close();</script></html>',
  });
  const err = await saveConfig('X').catch((e: unknown) => e);
  expect(err).toBeInstanceOf(SaveFailedError);
  expect((err as Error).message).toMatch(/Failed to write Config File/);
  vi.unstubAllGlobals();
  stubFetch({ '/Node/EditCfg.html': page, '/Node/CFGSave?N1': '<html>whatever</html>' });
  await expect(saveConfig('X')).rejects.toBeInstanceOf(SaveFailedError);
});

// What a browser puts in the form data set (HTML "constructing the entry list"), so a mail
// form posts exactly what the node's own page would.

test('a disabled field is not posted', () => {
  const spec = parseForm('<form action=/x><input name=a value=1 disabled><input name=b value=2><textarea name=t disabled>x</textarea></form>');
  expect(spec.fields[0]).toMatchObject({ name: 'a', disabled: true });
  expect(formPairs(spec, {})).toEqual([['b', '2']]);
  expect(formPairs(spec, { 'a#0': '9' })).toEqual([['b', '2']]);
});

test('a select multiple posts one pair per selected option; "\\n" separates given values', () => {
  const spec = parseForm('<form action=/x><select name=m multiple><option value=a selected>A<option value=b>B<option value=c selected>C</select></form>');
  expect(spec.fields[0]).toMatchObject({ type: 'select', multiple: true });
  expect(formPairs(spec, {})).toEqual([['m', 'a'], ['m', 'c']]);
  expect(formPairs(spec, { m: 'b' })).toEqual([['m', 'b']]);
  expect(formPairs(spec, { m: '' })).toEqual([]);
});

test('textarea line breaks go out as CRLF, as a browser sends them', () => {
  const spec = parseForm('<form action=/x><textarea name=t>a\nb</textarea><input name=i value=z></form>');
  expect(formPairs(spec, {})).toEqual([['t', 'a\r\nb'], ['i', 'z']]);
  expect(formPairs(spec, { t: 'x\ny\r\nz\r' })).toEqual([['t', 'x\r\ny\r\nz\r\n'], ['i', 'z']]);
  expect(encodePairs(formPairs(spec, { t: 'A\nB' }))).toBe('t=A%0D%0AB&i=z');
});

test('a checked checkbox posts its own value attribute, or "on" when it has none', () => {
  const spec = parseForm('<form action=/x><input type=checkbox name=Deltobin value=Deltobin><input type=checkbox name=EnF></form>');
  expect(formPairs(spec, { Deltobin: 'on', EnF: 'on' })).toEqual([['Deltobin', 'Deltobin'], ['EnF', 'on']]);
  expect(formPairs(spec, { Deltobin: '', EnF: '' })).toEqual([]);
});

test('a bare radio name picks the option among every radio of that name', () => {
  const html = '<form action=/x><input type=radio name=Type value=TypeB checked><input type=radio name=Type value=TypeP><input name=Type value=T1></form>';
  const spec = parseForm(html);
  expect(formPairs(spec, { Type: 'TypeP' })).toEqual([['Type', 'TypeP'], ['Type', 'T1']]);
  expect(formPairs(spec, {})).toEqual([['Type', 'TypeB'], ['Type', 'T1']]);
  // the text field sharing the name is addressed by its index
  expect(formPairs(spec, { Type: 'TypeP', 'Type#2': 'H' })).toEqual([['Type', 'TypeP'], ['Type', 'H']]);
});

test('a bare name shared by radios and other fields addresses only the radios, wherever the text field sits', () => {
  const spec = parseForm('<form action=/x><input name=Type value=T0><input type=radio name=Type value=B checked><input type=radio name=Type value=P></form>');
  expect(formPairs(spec, { Type: 'P' })).toEqual([['Type', 'T0'], ['Type', 'P']]);
  expect(formPairs(spec, { 'Type#0': 'Z', Type: 'P' })).toEqual([['Type', 'Z'], ['Type', 'P']]);
  // with no radio of that name, the bare name is the first field
  expect(formPairs(parseForm('<form action=/x><input name=a value=1><input name=a value=2></form>'), { a: '9' })).toEqual([['a', '9'], ['a', '2']]);
});

test('submitForm: a lost-session reply on the form\'s own old key leaves a newer cached key alone', async () => {
  signOut();
  stubFetch({ '/Mail/Header': () => fixture('mail-header.html') });
  const current = await mailKey();
  vi.unstubAllGlobals();
  const spec = parseForm(fixture('mail-conf.html'), 0, KEY_CONF);
  const old = '/Mail/Config?M0000000000OLD';
  stubFetch({ [old]: () => fixture('mail-lost.html') });
  await expect(submitForm({ ...spec, action: old, method: 'post' }, {})).rejects.toThrow(/dropped this mail session/);
  expect(currentMailKey()).toBe(current);
});
