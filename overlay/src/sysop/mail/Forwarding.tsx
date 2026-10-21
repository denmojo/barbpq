// Forwarding: the settings every partner shares (FwdCommon) and one partner's record (FWDSave).
import { useState } from 'preact/hooks';
import { Card } from '../../ui/Card';
import { ErrorNote } from '../../ui/ErrorNote';
import { Footer } from '../../public/Footer';
import { useShell } from '../shell';
import { getPicked, setPicked } from './drafts';
import { controlsOf, formValues, initialDraft, pipeBody } from './mailform';
import { loadFormPage, loadRecord, saveFormPage, saveRecord } from './maildata';
import { FormSection, useMailForm, type MailFormState } from './FormSection';
import { RecordPicker } from './RecordPicker';
import './mail.css';

/** Fill the open record's draft from another partner's record, as the old page's Copy from BBS does. */
function CopyFrom({ call, partners, state }: { call: string; partners: string[]; state: MailFormState }) {
  const others = partners.filter((p) => p !== call);
  const [from, setFrom] = useState(others[0] ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | undefined>();
  if (!others.length) return null;
  const copy = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const source = controlsOf(await loadRecord('fwd', from));
      const { values } = initialDraft(source);
      // Same form, same field order: copy every value the record save sends.
      state.merge(Object.fromEntries(Object.entries(values).filter(([k]) => state.controls.some((c) => c.key === k))));
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div class="mf-copy">
      <label>
        Copy settings from
        <select value={from} onChange={(e) => setFrom((e.currentTarget as HTMLSelectElement).value)}>
          {others.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </label>
      <button type="button" class="btn" disabled={busy || !state.spec} onClick={copy}>Copy</button>
      <span class="muted">Fills the form; nothing is saved until Save.</span>
      {error && <ErrorNote error={error} />}
    </div>
  );
}

export function Forwarding() {
  const shell = useShell();
  const partners = shell.fwd.data?.partners;
  const call = getPicked('forwarding') ?? partners?.[0] ?? null;
  const record = useMailForm(call ? `fwd:${call}` : null, () => loadRecord('fwd', call as string));
  const common = useMailForm('fwdcommon', () => loadFormPage('FWD'));

  return (
    <>
      <div class="titlebar">
        <h1>Forwarding</h1>
        <span class="sub">{partners ? `${partners.length} ${partners.length === 1 ? 'partner' : 'partners'}` : 'Loading'}</span>
      </div>
      {shell.fwd.error && !partners && <ErrorNote error={shell.fwd.error} />}
      <div class="grid">
        <Card title="Partners" span={12}>
          <RecordPicker label="Forwarding partners" calls={partners} picked={call} onPick={(c) => setPicked('forwarding', c)}
            empty="No BBS users are set up as forwarding partners." />
        </Card>
      </div>
      {call && (
        <FormSection title={`Forwarding for ${call}`} page="fwd" state={record}
          onSave={() => void record.save((_c, draft) => saveRecord('fwd', call, (spec) => pipeBody('fwd', controlsOf(spec), draft)))}>
          {partners && <CopyFrom key={call} call={call} partners={partners} state={record} />}
        </FormSection>
      )}
      <FormSection title="Shared forwarding settings" page="fwd" state={common}
        onSave={() => void common.save((controls, draft) => saveFormPage('FWD', formValues(controls, draft)))} />
      <Footer />
    </>
  );
}
