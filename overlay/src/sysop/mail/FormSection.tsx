// One old mail form as native fields: the hook holds the loaded form and the in-memory draft,
// FormSection draws the field map's groups with a Save that reports "Saved".
import type { ComponentChildren } from 'preact';
import { useEffect, useId, useMemo, useRef, useState } from 'preact/hooks';
import type { FormSpec } from '../../data/forms';
import { Card } from '../../ui/Card';
import { ErrorNote } from '../../ui/ErrorNote';
import { Skel } from '../../ui/Skel';
import { clearDraft, getDraft, setDraft } from './drafts';
import type { MailPage } from './fieldmaps';
import { controlsOf, initialDraft, isDirty, layout, type Control, type Draft } from './mailform';

export interface MailFormState {
  spec: FormSpec | null;
  controls: Control[];
  draft: Draft;
  dirty: boolean;
  loadError: Error | undefined;
  saving: boolean;
  saved: boolean;
  saveError: Error | undefined;
  set(key: string, value: string): void;
  /** Replace several values at once (copy settings from another record). */
  merge(values: Record<string, string>): void;
  discard(): void;
  reload(): void;
  save(run: (controls: Control[], draft: Draft) => Promise<FormSpec>): Promise<void>;
}

const toError = (e: unknown): Error => (e instanceof Error ? e : new Error(String(e)));

/** Load a form for `id` (null: nothing open) and keep its draft in the in-memory store. */
export function useMailForm(id: string | null, load: () => Promise<FormSpec>): MailFormState {
  const [spec, setSpec] = useState<FormSpec | null>(null);
  const [loadError, setLoadError] = useState<Error | undefined>();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<Error | undefined>();
  const [tries, setTries] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  useEffect(() => {
    if (id === null) return undefined;
    let current = true;
    setSpec(null);
    setLoadError(undefined);
    setSaved(false);
    setSaveError(undefined);
    loadRef.current().then(
      (s) => { if (current) setSpec(s); },
      (e: unknown) => { if (current) setLoadError(toError(e)); },
    );
    return () => { current = false; };
  }, [id, tries]);

  const controls = useMemo(() => (spec ? controlsOf(spec) : []), [spec]);
  const stored = id === null ? undefined : getDraft(id);
  const draft = stored ?? initialDraft(controls);
  const dirty = spec !== null && isDirty(controls, draft);

  const write = (next: Draft): void => {
    if (id === null) return;
    setDraft(id, next);
    setSaved(false);
    setSaveError(undefined);
  };

  return {
    spec, controls, draft, dirty, loadError, saving, saved, saveError,
    set(key, value) {
      const c = controls.find((x) => x.key === key);
      const touched = c?.secret && !draft.touched.includes(key) ? [...draft.touched, key] : draft.touched;
      write({ values: { ...draft.values, [key]: value }, touched });
    },
    merge(values) {
      write({ values: { ...draft.values, ...values }, touched: draft.touched });
    },
    discard() {
      if (id !== null) clearDraft(id);
      setSaveError(undefined);
    },
    reload() { setTries((n) => n + 1); },
    async save(run) {
      if (id === null) return;
      setSaving(true);
      setSaved(false);
      setSaveError(undefined);
      try {
        const next = await run(controls, draft);
        clearDraft(id);
        if (alive.current) {
          setSpec(next);
          setSaved(true);
        }
      } catch (e) {
        if (alive.current) setSaveError(toError(e));
      } finally {
        if (alive.current) setSaving(false);
      }
    },
  };
}

function Field({ c, state }: { c: Control; state: MailFormState }) {
  const id = useId();
  const value = state.draft.values[c.key] ?? '';
  const onInput = (e: Event) => state.set(c.key, (e.currentTarget as HTMLInputElement).value);
  const help = c.help ? <span class="mf-help">{c.help}</span> : null;
  if (c.type === 'checkbox') {
    return (
      <label class="mf-check">
        <input type="checkbox" checked={value !== ''} disabled={c.readOnly}
          onChange={(e) => state.set(c.key, (e.currentTarget as HTMLInputElement).checked ? 'on' : '')} />
        <span>{c.label}{help}</span>
      </label>
    );
  }
  if (c.type === 'radio') {
    return (
      <fieldset class="mf-radio">
        <legend>{c.label}</legend>
        {(c.options ?? []).map((o) => (
          <label key={o.value}>
            <input type="radio" name={`${id}-${c.name}`} checked={value === o.value} onChange={() => state.set(c.key, o.value)} />
            {o.label}
          </label>
        ))}
      </fieldset>
    );
  }
  let input: ComponentChildren;
  if (c.secret) {
    // Ruling: the page's password stays in memory; the box starts empty and is never filled from it.
    const typed = state.draft.touched.includes(c.key) ? value : '';
    input = (
      <input id={id} type="password" autocomplete="new-password" value={typed} onInput={onInput}
        placeholder={c.field.value ? 'Set (leave empty to keep it)' : 'Not set'} />
    );
  } else if (c.type === 'textarea') {
    input = <textarea id={id} rows={c.rows ?? 4} value={value} onInput={onInput} readOnly={c.readOnly} spellcheck={false} />;
  } else if (c.type === 'select') {
    input = (
      <select id={id} value={value} onChange={onInput} disabled={c.readOnly}>
        {(c.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  } else {
    input = <input id={id} type="text" value={value} onInput={onInput} readOnly={c.readOnly} spellcheck={false} />;
  }
  return (
    <div class={c.type === 'textarea' ? 'mf-field wide' : 'mf-field'}>
      <label for={id}>{c.label}</label>
      {input}
      {help}
    </div>
  );
}

function TableGroup({ rows, state }: { rows: Control[][]; state: MailFormState }) {
  const head = rows[0] ?? [];
  return (
    <div class="table-wrap">
      <table class="tbl mf-table">
        <thead><tr>{head.map((c) => <th key={c.key} scope="col">{c.label}</th>)}</tr></thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((c) => (
                <td key={c.key}>
                  <input type="text" aria-label={`${c.label} ${i + 1}`} value={state.draft.values[c.key] ?? ''} spellcheck={false}
                    onInput={(e) => state.set(c.key, (e.currentTarget as HTMLInputElement).value)} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The groups of the field map, then "Other settings" for anything the map does not name. */
export function MailFields({ page, state }: { page: MailPage; state: MailFormState }) {
  const { groups, other } = useMemo(() => layout(page, state.controls), [page, state.controls]);
  const wide = (cs: Control[]) => cs.length > 6 || cs.some((c) => c.type === 'textarea' && (c.rows ?? 4) > 3);
  return (
    <div class="grid mf-grid">
      {groups.map(({ group, controls, rows }) => (
        <Card key={group.label} title={group.label} span={rows || wide(controls) ? 12 : 6}>
          {group.help && <p class="muted mf-ghelp">{group.help}</p>}
          {rows ? <TableGroup rows={rows} state={state} /> : (
            <div class="mf-fields">{controls.map((c) => <Field key={c.key} c={c} state={state} />)}</div>
          )}
        </Card>
      ))}
      {other.length > 0 && (
        <Card title="Other settings" span={12}>
          <p class="muted mf-ghelp">Fields this version of the node sends that the new screens do not describe yet.</p>
          <div class="mf-fields">{other.map((c) => <Field key={c.key} c={c} state={state} />)}</div>
        </Card>
      )}
    </div>
  );
}

/** A titled form with Discard and Save; "Saved" once the node has answered with the saved page. */
export function FormSection({ title, page, state, onSave, children, extra }: {
  title: string; page: MailPage; state: MailFormState; onSave: () => void;
  /** Shown above the fields (record actions). */
  children?: ComponentChildren;
  /** Extra buttons beside Save. */
  extra?: ComponentChildren;
}) {
  const id = useId();
  return (
    <section class="mail-form" aria-labelledby={id}>
      <div class="mf-head">
        <h2 id={id}>{title}</h2>
        <span class="mf-status" role="status">{state.saving ? 'Saving…' : state.saved ? 'Saved' : state.dirty ? 'Unsaved changes' : ''}</span>
        <div class="mf-actions">
          {extra}
          <button type="button" class="btn" disabled={!state.dirty || state.saving} onClick={() => state.discard()}>Discard changes</button>
          <button type="button" class="btn primary" disabled={!state.dirty || state.saving} onClick={onSave}>Save</button>
        </div>
      </div>
      {state.saveError && <ErrorNote error={state.saveError} />}
      {children}
      {state.loadError ? (
        <div class="mf-loaderr">
          <ErrorNote error={state.loadError} />
          <button type="button" class="btn" onClick={() => state.reload()}>Try again</button>
        </div>
      ) : state.spec ? <MailFields page={page} state={state} /> : <p><Skel /></p>}
    </section>
  );
}
