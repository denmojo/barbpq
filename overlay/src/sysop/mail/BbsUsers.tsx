// BBS users: the BBS's accounts (UserList.txt), one user's record (UserSave), add and delete.
import { useEffect, useState } from 'preact/hooks';
import { Card } from '../../ui/Card';
import { ErrorNote } from '../../ui/ErrorNote';
import { Footer } from '../../public/Footer';
import { pickFrom, setPicked } from './drafts';
import { controlsOf, pipeBody } from './mailform';
import { addUser, deleteRecord, listRecords, loadRecord, saveRecord } from './maildata';
import { FormSection, useMailForm } from './FormSection';
import { ConfirmButton, RecordPicker } from './RecordPicker';
import './mail.css';

const toError = (e: unknown): Error => (e instanceof Error ? e : new Error(String(e)));

/** A call the node will take: it keeps six characters before any SSID and upper-cases them. */
export const newUserCall = (raw: string): string => raw.trim().toUpperCase().split('-')[0]!.slice(0, 6);

export function BbsUsers() {
  const [calls, setCalls] = useState<string[] | undefined>();
  const [listError, setListError] = useState<Error | undefined>();
  const [newCall, setNewCall] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<Error | undefined>();

  const refresh = (pick?: string) => listRecords('user').then(
    (c) => { setCalls(c); setListError(undefined); if (pick) setPicked('bbsusers', pick); },
    (e: unknown) => setListError(toError(e)),
  );
  useEffect(() => { void refresh(); }, []);

  const call = pickFrom('bbsusers', calls);
  const form = useMailForm(call ? `user:${call}` : null, () => loadRecord('user', call as string));

  const add = async () => {
    const c = newUserCall(newCall);
    if (!c) return;
    setBusy(true);
    setActionError(undefined);
    try {
      const list = await addUser(c);
      if (!list.includes(c)) throw new Error(`The node did not add ${c}; it may exist already`);
      setCalls(list);
      setPicked('bbsusers', c);
      setNewCall('');
    } catch (e) {
      setActionError(toError(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (c: string) => {
    setBusy(true);
    setActionError(undefined);
    try {
      const out = await deleteRecord('user', c);
      setCalls(out.value.calls);
      if (!out.value.gone && !out.interrupted) throw new Error(`The node did not delete ${c}`);
    } catch (e) {
      setActionError(toError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div class="titlebar">
        <h1>BBS users</h1>
        <span class="sub">{calls ? `${calls.length} ${calls.length === 1 ? 'user' : 'users'}` : 'Loading'}</span>
      </div>
      {listError && <ErrorNote error={listError} />}
      <div class="grid">
        <Card title="Users" span={12}>
          <RecordPicker label="BBS users" calls={calls} picked={call} onPick={(c) => setPicked('bbsusers', c)} empty="The BBS has no users." />
          <div class="mf-add">
            <label>
              Add a user
              <input type="text" value={newCall} maxLength={9} spellcheck={false} placeholder="Call"
                onInput={(e) => setNewCall((e.currentTarget as HTMLInputElement).value)} />
            </label>
            <button type="button" class="btn" disabled={busy || !newUserCall(newCall)} onClick={() => void add()}>Add</button>
          </div>
          {actionError && <ErrorNote error={actionError} />}
        </Card>
      </div>
      {call && (
        <FormSection title={`User ${call}`} page="user" state={form}
          onSave={() => void form.save((_c, draft, guard) => saveRecord('user', call, (spec) => pipeBody('user', controlsOf(spec), draft), guard))}
          extra={<ConfirmButton label="Delete user" confirm={`Delete ${call} from the BBS?`} busy={busy} onConfirm={() => void remove(call)} />} />
      )}
      <Footer />
    </>
  );
}
