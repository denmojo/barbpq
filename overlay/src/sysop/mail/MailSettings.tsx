// Mail settings: the BBS configuration (Conf), welcome messages and prompts (Wel), white pages (WP).
import { useEffect, useState } from 'preact/hooks';
import { Card } from '../../ui/Card';
import { ErrorNote } from '../../ui/ErrorNote';
import { Tabs } from '../../ui/Tabs';
import { Footer } from '../../public/Footer';
import { mailTab, pickFrom, setPicked, type MailTab } from './drafts';
import { controlsOf, formValues, pipeBody } from './mailform';
import { listRecords, loadFormPage, loadRecord, saveFormPage, saveRecord } from './maildata';
import { FormSection, useMailForm } from './FormSection';
import { RecordPicker } from './RecordPicker';
import './mail.css';


const TABS: { id: MailTab; label: string }[] = [
  { id: 'conf', label: 'Configuration' },
  { id: 'wel', label: 'Welcome & prompts' },
  { id: 'wp', label: 'White pages' },
];

function Conf() {
  const form = useMailForm('conf', () => loadFormPage('Conf'));
  return (
    <FormSection title="Mail configuration" page="conf" state={form}
      onSave={() => void form.save((controls, draft, guard) => saveFormPage('Conf', formValues(controls, draft), guard))} />
  );
}

function Welcome() {
  const form = useMailForm('wel', () => loadFormPage('Wel'));
  return (
    <FormSection title="Welcome messages and prompts" page="wel" state={form}
      onSave={() => void form.save((controls, draft, guard) => saveFormPage('Wel', formValues(controls, draft), guard))} />
  );
}

function WhitePages() {
  const [calls, setCalls] = useState<string[] | undefined>();
  const [error, setError] = useState<Error | undefined>();
  useEffect(() => {
    listRecords('wp').then(setCalls, (e: unknown) => setError(e instanceof Error ? e : new Error(String(e))));
  }, []);
  const call = pickFrom('wp', calls);
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
          onSave={() => void form.save((_c, draft, guard) => saveRecord('wp', call, (spec) => pipeBody('wp', controlsOf(spec), draft), guard))} />
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
