// Mail settings: the BBS configuration (Conf), welcome messages and prompts (Wel), white pages (WP).
import { signal } from '@preact/signals';
import { useEffect, useState } from 'preact/hooks';
import { Card } from '../../ui/Card';
import { ErrorNote } from '../../ui/ErrorNote';
import { Tabs } from '../../ui/Tabs';
import { Footer } from '../../public/Footer';
import { getPicked, setPicked } from './drafts';
import { controlsOf, formValues, pipeBody } from './mailform';
import { listRecords, loadFormPage, loadRecord, saveFormPage, saveRecord } from './maildata';
import { FormSection, useMailForm } from './FormSection';
import { RecordPicker } from './RecordPicker';
import './mail.css';

export type MailTab = 'conf' | 'wel' | 'wp';
export const mailTab = signal<MailTab>('conf');

const TABS: { id: MailTab; label: string }[] = [
  { id: 'conf', label: 'Configuration' },
  { id: 'wel', label: 'Welcome & prompts' },
  { id: 'wp', label: 'White pages' },
];

function Conf() {
  const form = useMailForm('conf', () => loadFormPage('Conf'));
  return (
    <FormSection title="Mail configuration" page="conf" state={form}
      onSave={() => void form.save((controls, draft) => saveFormPage('Conf', formValues(controls, draft)))} />
  );
}

function Welcome() {
  const form = useMailForm('wel', () => loadFormPage('Wel'));
  return (
    <FormSection title="Welcome messages and prompts" page="wel" state={form}
      onSave={() => void form.save((controls, draft) => saveFormPage('Wel', formValues(controls, draft)))} />
  );
}

function WhitePages() {
  const [calls, setCalls] = useState<string[] | undefined>();
  const [error, setError] = useState<Error | undefined>();
  useEffect(() => {
    listRecords('wp').then(setCalls, (e: unknown) => setError(e instanceof Error ? e : new Error(String(e))));
  }, []);
  const call = getPicked('wp') ?? calls?.[0] ?? null;
  const form = useMailForm(call ? `wp:${call}` : null, () => loadRecord('wp', call as string));
  return (
    <>
      {error && <ErrorNote error={error} />}
      <div class="grid">
        <Card title="White pages records" span={12}>
          <RecordPicker label="White pages records" calls={calls} picked={call} onPick={(c) => setPicked('wp', c)} empty="The white pages are empty." />
        </Card>
      </div>
      {call && (
        <FormSection title={`White pages for ${call}`} page="wp" state={form}
          onSave={() => void form.save((_c, draft) => saveRecord('wp', call, (spec) => pipeBody('wp', controlsOf(spec), draft)))} />
      )}
    </>
  );
}

export function MailSettings() {
  const tab = mailTab.value;
  return (
    <>
      <div class="titlebar">
        <h1>Mail settings</h1>
        <span class="sub">Saved settings apply at once; the BBS needs no restart.</span>
      </div>
      <Tabs label="Mail settings" items={TABS} value={tab} onChange={(id) => { mailTab.value = id as MailTab; }} />
      {tab === 'conf' ? <Conf /> : tab === 'wel' ? <Welcome /> : <WhitePages />}
      <Footer />
    </>
  );
}
