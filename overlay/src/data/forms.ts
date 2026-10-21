// Parse the node's old HTML forms and post them back. The user never sees these pages.
import { encodeLatin1Form, getText, latin1Bytes, ParseError, postBody } from './http';
import { assertAuthorized, getProtected, withSysop } from './session';

export interface FieldOption { value: string; label: string; selected: boolean }
export interface FormField {
  name: string;
  /** text, hidden, checkbox, radio, submit, select, textarea, ... as written on the page. */
  type: string;
  value: string;
  options?: FieldOption[];
  checked?: boolean;
}
export interface FormSpec { action: string; method: 'get' | 'post'; fields: FormField[] }

/** Config save limit: the node drops requests over 100,000 bytes, and the body adds framing. */
export const CFG_SAVE_LIMIT = 99_000;

/**
 * Read one form. `baseUrl` resolves a relative action (the Edit Config form posts to
 * CFGSave?<key> from /Node/EditCfg.html); the result is path plus query.
 */
export function parseForm(html: string, formIndex = 0, baseUrl = '/'): FormSpec {
  const d = new DOMParser().parseFromString(html, 'text/html');
  const form = d.forms[formIndex];
  if (!form) throw new ParseError('form page', `form ${formIndex}`);
  const raw = form.getAttribute('action') ?? '';
  const u = new URL(raw, new URL(baseUrl, 'http://node.invalid'));
  const fields: FormField[] = [];
  for (const el of Array.from(form.elements)) {
    const name = el.getAttribute('name');
    if (!name) continue;
    if (el instanceof HTMLSelectElement) {
      const options = Array.from(el.options).map((o) => ({ value: o.value, label: o.text, selected: o.selected }));
      fields.push({ name, type: 'select', value: el.value, options });
    } else if (el instanceof HTMLTextAreaElement) {
      fields.push({ name, type: 'textarea', value: el.value });
    } else if (el instanceof HTMLInputElement) {
      const type = (el.getAttribute('type') ?? 'text').toLowerCase();
      if (type === 'checkbox' || type === 'radio') {
        fields.push({ name, type, value: el.hasAttribute('value') ? el.value : 'on', checked: el.checked });
      } else {
        fields.push({ name, type, value: el.getAttribute('value') ?? '' });
      }
    }
  }
  const method = (form.getAttribute('method') ?? 'get').toLowerCase() === 'post' ? 'post' : 'get';
  return { action: u.pathname + u.search, method, fields };
}

/**
 * Build the field/value pairs a browser would send. Every field goes, edited or not, so a
 * save never drops settings the user did not touch.
 *
 * `values` is keyed by field name; for a repeated name `name#2` addresses the third field
 * (`name` alone addresses the first). Checkbox: '' unchecks, any other string checks.
 * Radio: the value selects the option. Submit buttons are sent only when named in `values`
 * (the button that was pressed).
 */
export function formPairs(spec: FormSpec, values: Record<string, string>): [string, string][] {
  const seen = new Map<string, number>();
  const radioPicked = new Set<string>();
  const out: [string, string][] = [];
  for (const f of spec.fields) {
    const n = seen.get(f.name) ?? 0;
    seen.set(f.name, n + 1);
    const key = `${f.name}#${n}` in values ? `${f.name}#${n}` : n === 0 && f.name in values ? f.name : null;
    const given = key === null ? undefined : values[key];
    switch (f.type) {
      case 'submit':
      case 'button':
      case 'image':
      case 'reset':
        if (given !== undefined) out.push([f.name, given === '' ? f.value : given]);
        break;
      case 'checkbox': {
        const on = given === undefined ? !!f.checked : given !== '';
        if (on) out.push([f.name, given !== undefined && given !== '' ? given : f.value]);
        break;
      }
      case 'radio': {
        const on = given === undefined ? !!f.checked : given === f.value;
        if (on && !radioPicked.has(f.name)) {
          radioPicked.add(f.name);
          out.push([f.name, f.value]);
        }
        break;
      }
      default:
        out.push([f.name, given ?? f.value]);
    }
  }
  return out;
}

export function encodePairs(pairs: [string, string][]): string {
  return pairs.map(([k, v]) => `${encodeLatin1Form(k)}=${encodeLatin1Form(v)}`).join('&');
}

/** Post the form and return the reply page. Throws NotAuthorizedError on a sign-in reply. */
export async function submitForm(spec: FormSpec, values: Record<string, string>): Promise<string> {
  const body = encodePairs(formPairs(spec, values));
  const reply =
    spec.method === 'get'
      ? await getText(`${spec.action}${spec.action.includes('?') ? '&' : '?'}${body}`)
      : await postBody(spec.action, latin1Bytes(body));
  return assertAuthorized(reply);
}

/**
 * Edit Config save body: `Msg=` + text + `&Save=Save`, as the page's Save button sends it. The
 * node's decoder reads only uppercase %XX and '+' for space, so everything else is escaped; CRs
 * are dropped (the node strips them).
 */
export function encodeCfgSave(text: string): Uint8Array {
  return latin1Bytes(`Msg=${encodeLatin1Form(text.replace(/\r/g, ''))}&Save=Save`);
}

export function cfgSaveTooLarge(body: Uint8Array): boolean {
  return body.length > CFG_SAVE_LIMIT;
}

/** The node's confirmation, from SaveConfigFile in HTTPcode.c: alert("Configuration Saved, Orig Length N New Length M"). */
const SAVE_OK = /alert\("Configuration Saved, Orig Length \d+ New Length \d+"\)/;

/** The node answered a config save without its "Configuration Saved" confirmation. */
export class SaveFailedError extends Error {
  constructor(readonly reply: string) {
    const m = /alert\("([^"]*)"\)/.exec(reply);
    super(m ? `Config save failed: ${m[1]}` : 'Config save failed: no confirmation from the node');
    this.name = 'SaveFailedError';
  }
}

/**
 * The raw config text of the Edit Config page. The node writes bpq32.cfg into the textarea
 * unescaped, so HTML parsing would change it (&amp; decoded, leading newline dropped, a literal
 * </textarea> truncating). Take the bytes between the opening tag and the LAST </textarea>.
 */
export function extractConfigText(html: string): string {
  const open = /<textarea\b[^>]*>/i.exec(html);
  const end = html.toLowerCase().lastIndexOf('</textarea>');
  if (!open || end < open.index + open[0].length) throw new ParseError('Edit Config', 'config text');
  return html.slice(open.index + open[0].length, end);
}

/** Config text encodes to more than the node accepts in one request. */
export class CfgTooLargeError extends Error {
  constructor(readonly bytes: number) {
    super(`Config body is ${bytes} bytes; the limit is ${CFG_SAVE_LIMIT}`);
    this.name = 'CfgTooLargeError';
  }
}

/**
 * Save bpq32.cfg. Encodes first (NonLatin1Error / CfgTooLargeError before any request), then
 * reads the Edit Config form for its session-keyed action and posts the body, retrying once
 * after a sign-in if the node asks for one.
 */
export async function saveConfig(text: string): Promise<void> {
  const body = encodeCfgSave(text);
  if (cfgSaveTooLarge(body)) throw new CfgTooLargeError(body.length);
  await withSysop(async () => {
    const spec = parseForm(await getProtected('/Node/EditCfg.html'), 0, '/Node/EditCfg.html');
    const reply = assertAuthorized(await postBody(spec.action, body));
    if (!SAVE_OK.test(reply)) throw new SaveFailedError(reply);
  });
}
