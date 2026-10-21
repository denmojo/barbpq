import { formPairs, parseForm, type FormSpec } from '../../../data/forms';
import { fixture } from '../../../data/__tests__/helpers';
import { ACTION_FIELDS, fieldMap, type MailPage } from '../fieldmaps';
import { changedOnNode, controlsOf, editedKeys, formValues, initialDraft, isDirty, layout, pipeBody, PipeFieldError, type Control } from '../mailform';
import { CMS_HIDDEN, confPage, fwdPage, ISP_PASSWORD, userPage, USER_PASSWORD } from './sample';

/** Each page's fixture form; 'fwd' has two forms (the shared settings and one partner's record). */
const FORMS: [MailPage, () => FormSpec][] = [
  ['conf', () => parseForm(confPage())],
  ['fwd', () => parseForm(fixture('mail-fwd.html'))],
  ['fwd', () => parseForm(fwdPage('RMS'))],
  ['user', () => parseForm(userPage('RMS'))],
  ['hk', () => parseForm(fixture('mail-hk.html'))],
  ['wel', () => parseForm(fixture('mail-wel.html'))],
  ['wp', () => parseForm(fixture('mail-wpdetails-n0call.html'))],
];

const keysOf = (cs: Control[]) => cs.map((c) => c.key);

test.each(FORMS)('%s: every field of the old form is in exactly one group or under Other settings', (page, load) => {
  const spec = load();
  const controls = controlsOf(spec);
  const { groups, other } = layout(page, controls);
  const placed = [...groups.flatMap((g) => g.controls), ...other].map((c) => c.key);
  const actions = ACTION_FIELDS[page];
  const expected = keysOf(controls).filter((k) => !actions.includes(k.replace(/#\d+$/, '')));
  expect([...placed].sort()).toEqual([...expected].sort());
  expect(new Set(placed).size).toBe(placed.length);
});

test.each(FORMS)('%s: the map names only fields the node page has, and nothing is left unlabelled', (page, load) => {
  const spec = load();
  const names = new Set(spec.fields.map((f) => f.name));
  const { other } = layout(page, controlsOf(spec));
  // the fixture forms are fully mapped; Other settings exists for fields a node version adds
  expect(other).toEqual([]);
  for (const g of fieldMap(page)) {
    for (const f of g.fields) {
      // a map covers both forwarding forms; each form only has its own fields
      if (page !== 'fwd') expect(names.has(f.name), `${page} ${f.name}`).toBe(true);
    }
  }
});

test('a field the map does not name renders under Other settings', () => {
  const spec = parseForm(fixture('mail-hk.html').replace('<input name="OvUnsent"', '<input name="NewThing" value="5"><input name="OvUnsent"'));
  const { other } = layout('hk', controlsOf(spec));
  expect(other.map((c) => c.name)).toEqual(['NewThing']);
  expect(other[0]?.label).toBe('NewThing');
});

test('conf: the FBB filter table has five rows of Action, Type, From, TO, AT, BID, MaxLen; the WP Type radio is one control', () => {
  const controls = controlsOf(parseForm(confPage()));
  const { groups } = layout('conf', controls);
  const table = groups.find((g) => g.group.table);
  expect(table?.rows).toHaveLength(5);
  expect(table?.rows?.[0]?.map((c) => c.key)).toEqual(['Action#0', 'Type#2', 'From#0', 'TO#0', 'AT#0', 'BID#0', 'MaxLen#0']);
  const radio = controls.filter((c) => c.name === 'Type' && c.type === 'radio');
  expect(radio).toHaveLength(1);
  expect(radio[0]?.options?.map((o) => o.value)).toEqual(['TypeB', 'TypeP']);
});

test.each(['conf', 'hk', 'wel'] as const)('%s: an untouched draft posts exactly what the node page posts', (page) => {
  const spec = parseForm(page === 'conf' ? confPage() : fixture(`mail-${page}.html`));
  const controls = controlsOf(spec);
  const draft = initialDraft(controls);
  expect(isDirty(controls, draft)).toBe(false);
  expect(formPairs(spec, formValues(controls, draft))).toEqual(formPairs(spec, {}));
});

test('conf: the ISP password starts empty, posts the original untouched, and a typed one replaces it', () => {
  const spec = parseForm(confPage());
  const controls = controlsOf(spec);
  const pw = controls.find((c) => c.name === 'ISPPassword');
  expect(pw?.secret).toBe(true);
  const draft = initialDraft(controls);
  expect(draft.values[pw!.key]).toBe('');
  expect(new URLSearchParams(formPairs(spec, formValues(controls, draft))).get('ISPPassword')).toBe(ISP_PASSWORD);
  const typed = { values: { ...draft.values, [pw!.key]: 'newOne' }, touched: [pw!.key] };
  expect(isDirty(controls, typed)).toBe(true);
  expect(new URLSearchParams(formPairs(spec, formValues(controls, typed))).get('ISPPassword')).toBe('newOne');
});

test('fwd: the record posts the 20 fields the old save() joins, in order, each followed by |', () => {
  const controls = controlsOf(parseForm(fwdPage('RMS')));
  const body = pipeBody('fwd', controls, initialDraft(controls));
  expect(body).toBe(
    'RMS\n|||ATTACH 1\nNOFALLBACK\nC CMS\nELSE\nC 2 W6SAR-10\n||||' +
    'true|1800|false|0|true|true|10000|false|true|false|true|false|120|',
  );
  const edited = initialDraft(controls);
  edited.values['Interval#0'] = '1700';
  edited.values['EnR#0'] = 'on';
  expect(pipeBody('fwd', controls, edited)).toContain('|true|1700|true|0|');
});

test('user: the record posts the 27 fields of the old save(), passwords unchanged when untouched', () => {
  const controls = controlsOf(parseForm(userPage('RMS')));
  const draft = initialDraft(controls);
  for (const c of controls.filter((x) => x.secret)) expect(draft.values[c.key]).toBe('');
  const parts = pipeBody('user', controls, draft).split('|');
  expect(parts).toEqual([
    'true', 'false', 'false', 'false', 'false', 'false', 'false', '', '', '', '',
    'false', 'false', 'false', 'false', 'true', 'false', 'false', 'false', '', '0', '',
    USER_PASSWORD, CMS_HIDDEN, '', '', '', '',
  ]);
  const typed = { values: { ...draft.values, 'Password#0': 'fresh1' }, touched: ['Password#0'] };
  expect(pipeBody('user', controls, typed).split('|')[22]).toBe('fresh1');
});

test('wp: the record posts Name|Home1|Home2|QTH1|QTH2|ZIP1|ZIP2|; the status fields are read-only', () => {
  const controls = controlsOf(parseForm(fixture('mail-wpdetails-n0call.html')));
  expect(pipeBody('wp', controls, initialDraft(controls))).toBe('B|||||||');
  const { groups } = layout('wp', controls);
  const status = groups.find((g) => g.controls.some((c) => c.name === 'Modif'));
  expect(status?.controls.every((c) => c.readOnly)).toBe(true);
});

test('a | in a field, or a word the node reads as another command, is refused before anything is sent', () => {
  const user = controlsOf(parseForm(userPage('RMS')));
  const d = initialDraft(user);
  expect(() => pipeBody('user', user, { ...d, values: { ...d.values, 'Name#0': 'a|b' } })).toThrow(PipeFieldError);
  expect(() => pipeBody('user', user, { ...d, values: { ...d.values, 'QTH#0': 'Delete St' } })).toThrow(/Delete/);
  expect(() => pipeBody('user', user, { ...d, values: { ...d.values, 'Name#0': 'Cancel' } })).toThrow(/Cancel/);
  expect(() => pipeBody('user', user, { ...d, values: { ...d.values, 'HomeBBS#0': 'Add=X' } })).toThrow(/Add=/);
  const fwd = controlsOf(parseForm(fwdPage('RMS')));
  const f = initialDraft(fwd);
  expect(() => pipeBody('fwd', fwd, { ...f, values: { ...f.values, 'FWD#0': 'StartForward' } })).toThrow(/StartForward/);
});

test('a password box typed in and cleared counts as untouched: not dirty, and the page value is posted', () => {
  const spec = parseForm(confPage());
  const controls = controlsOf(spec);
  const pw = controls.find((c) => c.name === 'ISPPassword')!;
  const d = initialDraft(controls);
  const cleared = { values: { ...d.values, [pw.key]: '' }, touched: [pw.key] };
  expect(isDirty(controls, cleared)).toBe(false);
  expect(new URLSearchParams(formPairs(spec, formValues(controls, cleared))).get('ISPPassword')).toBe(ISP_PASSWORD);
  const user = controlsOf(parseForm(userPage('RMS')));
  const u = initialDraft(user);
  const uc = { values: { ...u.values, 'Password#0': '' }, touched: ['Password#0'] };
  expect(pipeBody('user', user, uc).split('|')[22]).toBe(USER_PASSWORD);
});

test('changedOnNode: a field the sysop did not edit that differs on the node is a conflict; an edited one is not', () => {
  const before = parseForm(confPage());
  const after = parseForm(confPage().replace('<input value="0" size="3" name="UIInterval">', '<input value="15" size="3" name="UIInterval">'));
  expect(changedOnNode(before, parseForm(confPage()), [])).toBe(false);
  expect(changedOnNode(before, after, [])).toBe(true);
  expect(changedOnNode(before, after, ['UIInterval#0'])).toBe(false);
  const pwChanged = parseForm(confPage().replace(`value="${ISP_PASSWORD}"`, 'value="other"'));
  expect(changedOnNode(before, pwChanged, [])).toBe(true);
  expect(changedOnNode(before, parseForm('<form><input name=a></form>'), [])).toBe(true);
});

test('editedKeys lists changed values and passwords typed in, not cleared ones', () => {
  const controls = controlsOf(parseForm(confPage()));
  const d = initialDraft(controls);
  expect(editedKeys(controls, d)).toEqual([]);
  const e = { values: { ...d.values, 'Streams#0': '12', 'ISPPassword#0': '' }, touched: ['ISPPassword#0'] };
  expect(editedKeys(controls, e)).toEqual(['Streams#0']);
  expect(editedKeys(controls, { ...e, values: { ...e.values, 'ISPPassword#0': 'n' } })).toEqual(['Streams#0', 'ISPPassword#0']);
});

test('a disabled field is a read-only control; a multiple select starts with its selected options', () => {
  const controls = controlsOf(parseForm('<form><input name=a value=1 disabled><select name=m multiple><option value=x selected>X<option value=y selected>Y<option value=z>Z</select></form>'));
  expect(controls[0]?.readOnly).toBe(true);
  expect(initialDraft(controls).values['m#0']).toBe('x\ny');
});
