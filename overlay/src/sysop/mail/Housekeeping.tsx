// Housekeeping: message and log lifetimes and the daily run (the old HK page), and Run now.
import { useState } from 'preact/hooks';
import { ErrorNote } from '../../ui/ErrorNote';
import { Footer } from '../../public/Footer';
import { formValues } from './mailform';
import { loadFormPage, saveFormPage } from './maildata';
import { FormSection, useMailForm } from './FormSection';
import { ConfirmButton } from './RecordPicker';
import './mail.css';

export function Housekeeping() {
  const form = useMailForm('hk', () => loadFormPage('HK'));
  const [run, setRun] = useState<'idle' | 'running' | 'done'>('idle');
  const [runError, setRunError] = useState<Error | undefined>();

  // The old page's Run Housekeeping button posts the form as loaded; the node runs and saves nothing.
  const runNow = async () => {
    setRun('running');
    setRunError(undefined);
    try {
      await saveFormPage('HK', {}, undefined, ['RunNow', 'Run Housekeeping']);
      setRun('done');
    } catch (e) {
      setRunError(e instanceof Error ? e : new Error(String(e)));
      setRun('idle');
    }
  };

  return (
    <>
      <div class="titlebar">
        <h1>Housekeeping</h1>
        <span class="sub">Lifetimes and the daily clean-up. Saved settings apply at once.</span>
      </div>
      <FormSection title="Housekeeping settings" page="hk" state={form}
        onSave={() => void form.save((controls, draft, guard) => saveFormPage('HK', formValues(controls, draft), guard))}
        extra={<ConfirmButton label="Run now" busy={run === 'running'}
          confirm="Run housekeeping now? It deletes messages past their lifetimes." onConfirm={() => void runNow()} />}>
        {run !== 'idle' && <p class="mf-note" role="status">{run === 'running' ? 'Running housekeeping…' : 'Housekeeping ran.'}</p>}
        {runError && <ErrorNote error={runError} />}
      </FormSection>
      <Footer />
    </>
  );
}
