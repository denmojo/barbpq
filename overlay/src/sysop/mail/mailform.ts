// A mail page's form as editable controls, laid out by the field map, and the bodies a save
// posts: the form pairs a browser would send, or the "|" text the record pages' script sends.
import type { FieldOption, FormField, FormSpec } from '../../data/forms';
import {
  ACTION_FIELDS, fieldMap, PIPE_ORDER, PIPE_TRIGGERS, SECRET_FIELDS,
  type FieldGroup, type MailPage, type MappedField, type PipePage,
} from './fieldmaps';

const BUTTONS = new Set(['submit', 'button', 'image', 'reset']);

export interface Control {
  /** "name#n" (n counts every field of that name, as formPairs does); a radio group is its bare name. */
  key: string;
  name: string;
  /** text, checkbox, radio, select, textarea or hidden. */
  type: string;
  field: FormField;
  occurrence: number;
  /** Radio choices, or a select's options. */
  options?: FieldOption[];
  /** A password: kept in memory only, never drawn; untouched it posts the page's value. */
  secret: boolean;
  readOnly: boolean;
  label: string;
  help?: string;
  rows?: number;
}

/** Edits in progress. `touched` lists the password fields the sysop typed in. */
export interface Draft { values: Record<string, string>; touched: string[] }

export interface PlacedGroup { group: FieldGroup; controls: Control[]; rows?: Control[][] }

/** Every field of the form except buttons, unlabelled; layout() puts the labels on. */
export function controlsOf(spec: FormSpec): Control[] {
  const seen = new Map<string, number>();
  const radios = new Map<string, Control>();
  const out: Control[] = [];
  for (const field of spec.fields) {
    const n = seen.get(field.name) ?? 0;
    seen.set(field.name, n + 1);
    if (BUTTONS.has(field.type)) continue;
    if (field.type === 'radio') {
      const group = radios.get(field.name);
      const option = { value: field.value, label: field.value, selected: !!field.checked };
      if (group) {
        group.options!.push(option);
        continue;
      }
      const c: Control = { key: field.name, name: field.name, type: 'radio', field, occurrence: n, options: [option], secret: false, readOnly: false, label: field.name };
      radios.set(field.name, c);
      out.push(c);
      continue;
    }
    out.push({
      key: `${field.name}#${n}`,
      name: field.name,
      type: field.type === 'password' ? 'text' : field.type,
      field,
      occurrence: n,
      options: field.options,
      secret: field.type === 'password' || SECRET_FIELDS.has(field.name),
      readOnly: false,
      label: field.name,
    });
  }
  return out;
}

const matches = (m: MappedField, c: Control): boolean =>
  m.name === c.name && (m.type === undefined || m.type === c.type) && (m.index === undefined || m.index === c.occurrence);

function labelled(c: Control, m: MappedField): Control {
  const options = c.options && m.options ? c.options.map((o) => ({ ...o, label: m.options?.[o.value] ?? o.label })) : c.options;
  return { ...c, label: m.label, help: m.help, rows: m.rows, readOnly: !!m.readOnly, options };
}

/**
 * Place each control in the first map group that names it. A table group gives one row per
 * occurrence. Controls no group names (and not tied to a button) go to `other`, under their name.
 */
export function layout(page: MailPage, controls: Control[]): { groups: PlacedGroup[]; other: Control[] } {
  const used = new Set<string>();
  const groups: PlacedGroup[] = [];
  for (const group of fieldMap(page)) {
    const placed: Control[] = [];
    const columns: Control[][] = [];
    for (const m of group.fields) {
      const hits = controls.filter((c) => !used.has(c.key) && matches(m, c));
      hits.forEach((c) => used.add(c.key));
      const done = hits.map((c) => labelled(c, m));
      placed.push(...done);
      columns.push(done);
    }
    if (!placed.length) continue;
    const rows = group.table
      ? Array.from({ length: Math.max(...columns.map((col) => col.length)) }, (_, i) => columns.map((col) => col[i]).filter((c): c is Control => !!c))
      : undefined;
    groups.push(rows ? { group, controls: placed, rows } : { group, controls: placed });
  }
  const actions = ACTION_FIELDS[page];
  const other = controls.filter((c) => !used.has(c.key) && c.type !== 'hidden' && !actions.includes(c.name));
  return { groups, other };
}

/** The page's values; a checkbox is 'on' or '', a password starts empty. */
export function initialDraft(controls: Control[]): Draft {
  const values: Record<string, string> = {};
  for (const c of controls) {
    if (c.secret) values[c.key] = '';
    else if (c.type === 'checkbox') values[c.key] = c.field.checked ? 'on' : '';
    else if (c.type === 'radio') values[c.key] = c.options?.find((o) => o.selected)?.value ?? '';
    else values[c.key] = c.field.value;
  }
  return { values, touched: [] };
}

const untouchedSecret = (c: Control, d: Draft): boolean => c.secret && !d.touched.includes(c.key);

/** Values for formPairs. An untouched password is left out, so the page's own value goes. */
export function formValues(controls: Control[], draft: Draft): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of controls) {
    if (untouchedSecret(c, draft) || c.readOnly) continue;
    const v = draft.values[c.key];
    if (v !== undefined) out[c.key] = v;
  }
  return out;
}

export function isDirty(controls: Control[], draft: Draft): boolean {
  const start = initialDraft(controls);
  return controls.some((c) => (c.secret ? draft.touched.includes(c.key) : draft.values[c.key] !== start.values[c.key]));
}

/** A record field the node would misread: a "|", or a word its save handler treats as a command. */
export class PipeFieldError extends Error {
  constructor(readonly field: string, message: string) {
    super(message);
    this.name = 'PipeFieldError';
  }
}

/** The text the record page's save() posts: each field and "|", a checkbox as true or false. */
export function pipeBody(page: PipePage, controls: Control[], draft: Draft): string {
  let body = '';
  for (const name of PIPE_ORDER[page]) {
    const c = controls.find((x) => x.name === name);
    let v: string;
    if (!c) v = '';
    else if (c.type === 'checkbox') v = draft.values[c.key] ? 'true' : 'false';
    else if (untouchedSecret(c, draft)) v = c.field.value;
    else v = draft.values[c.key] ?? c.field.value;
    if (v.includes('|')) throw new PipeFieldError(name, `${c?.label ?? name} cannot contain "|": the node splits the record on it`);
    body += `${v}|`;
  }
  for (const word of PIPE_TRIGGERS[page]) {
    if (body.includes(word)) {
      throw new PipeFieldError(word, `A field contains "${word}", which the node reads as a command and would not save this record. Change that text.`);
    }
  }
  return body;
}
