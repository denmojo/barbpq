// One BBS message, opened from the Messages list: every field the node's MsgDetails reports,
// its forwarding table, its text, and the changes the old Msgs page allows (release, hold, kill,
// the forwarding cells, and the From/To/BID/Email from/VIA/Title/Type/Status fields). Each change
// is read back from the node's reply; nothing is shown that the node did not send.
import { useEffect, useId, useRef, useState } from 'preact/hooks';
import { Card } from '../../ui/Card';
import { ErrorNote } from '../../ui/ErrorNote';
import { Skel } from '../../ui/Skel';
import { Unknown } from '../../ui/Unknown';
import { ConfirmButton } from './RecordPicker';
import { messageNote } from './drafts';
import {
  loadMessage, MSG_LIMITS, MSG_STATUSES, MSG_TYPES, nextFwdState, readMessageText, releaseStatus, saveMessage, setStatus, stepForward,
  type FwdState, type MessageDetail, type MsgEdit, type MsgField, type Outcome,
} from './msgactions';

export const STATUS_NAME: Record<string, string> = {
  N: 'New', Y: 'Read', F: 'Forwarded', K: 'Killed', H: 'Held', D: 'Delivered', $: 'Bulletin',
};
const TYPE_NAME: Record<string, string> = { P: 'Personal', B: 'Bulletin', T: 'NTS' };
const FWD_NAME: Record<FwdState, string> = { sent: 'Sent', queued: 'Queued', none: 'Not for this partner' };
const STEP_LABEL: Record<FwdState, string> = { none: 'Queue for', queued: 'Mark sent to', sent: 'Clear for' };

const toError = (e: unknown): Error => (e instanceof Error ? e : new Error(String(e)));
const statusText = (s: string): string => (STATUS_NAME[s] ? `${s} (${STATUS_NAME[s]})` : s);

const EDIT_FIELDS: { k: Exclude<MsgField, 'type' | 'status'>; label: string }[] = [
  { k: 'from', label: 'From' }, { k: 'to', label: 'To' }, { k: 'via', label: 'VIA' },
  { k: 'bid', label: 'BID' }, { k: 'efrom', label: 'Email from' }, { k: 'subject', label: 'Title' },
];

function Fields({ m }: { m: MessageDetail }) {
  const row = (k: string, v: string, mono = true) => (
    <div><dt>{k}</dt><dd class={mono ? 'mono' : undefined}>{v || <span class="muted">(empty)</span>}</dd></div>
  );
  return (
    <dl class="msg-fields">
      {row('From', m.from)}
      {row('To', m.to)}
      {row('VIA', m.via)}
      {row('BID', m.bid)}
      {row('Type', TYPE_NAME[m.type] ? `${m.type} (${TYPE_NAME[m.type]})` : m.type)}
      {row('Status', statusText(m.status))}
      {row('Sent', m.sent)}
      {row('Received', m.rx)}
      {row('Last changed', m.lastChange)}
      <div><dt>Size</dt><dd class="mono">{Number.isFinite(m.size) ? `${m.size} bytes` : <Unknown reason="The node gave no size" />}</dd></div>
      {row('Email from', m.efrom)}
      {row('Attachments', m.attachments ? 'Yes' : 'None', false)}
      <div class="wide"><dt>Title</dt><dd>{m.subject || <span class="muted">(empty)</span>}</dd></div>
    </dl>
  );
}

function EditForm({ m, busy, onSave, onCancel }: {
  m: MessageDetail; busy: boolean; onSave: (edit: MsgEdit) => void; onCancel: () => void;
}) {
  const [v, setV] = useState<Record<MsgField, string>>({
    from: m.from, to: m.to, via: m.via, bid: m.bid, efrom: m.efrom, subject: m.subject, type: m.type, status: m.status,
  });
  const id = useId();
  const set = (k: MsgField) => (e: Event) => setV({ ...v, [k]: (e.currentTarget as HTMLInputElement).value });
  const edit: MsgEdit = Object.fromEntries((Object.keys(v) as MsgField[]).filter((k) => v[k] !== m[k]).map((k) => [k, v[k]]));
  return (
    <form class="msg-edit" onSubmit={(e) => { e.preventDefault(); onSave(edit); }}>
      <div class="mf-fields">
        {EDIT_FIELDS.map(({ k, label }) => (
          <div class="mf-field" key={k}>
            <label for={`${id}-${k}`}>{label}</label>
            <input id={`${id}-${k}`} type="text" value={v[k]} spellcheck={false} onInput={set(k)} />
            <span class="mf-help">{`At most ${MSG_LIMITS[k]} bytes; no "|"`}</span>
          </div>
        ))}
        <div class="mf-field">
          <label for={`${id}-type`}>Type</label>
          <select id={`${id}-type`} value={v.type} onChange={set('type')}>
            {MSG_TYPES.map((t) => <option key={t} value={t}>{TYPE_NAME[t] ? `${t} (${TYPE_NAME[t]})` : t}</option>)}
          </select>
        </div>
        <div class="mf-field">
          <label for={`${id}-status`}>Status</label>
          <select id={`${id}-status`} value={v.status} onChange={set('status')}>
            {/* No K here unless the message is killed already: a kill goes through Kill, which asks first. */}
            {MSG_STATUSES.filter((s) => s !== 'K' || m.status === 'K').map((s) => <option key={s} value={s}>{statusText(s)}</option>)}
          </select>
          {m.status !== 'K' && <span class="mf-help">To kill the message, use Kill, which asks first.</span>}
        </div>
      </div>
      <div class="msg-actions">
        <button type="button" class="btn" onClick={onCancel}>Cancel</button>
        <button type="submit" class="btn primary" disabled={busy || Object.keys(edit).length === 0}>Save fields</button>
      </div>
    </form>
  );
}

type Load = { phase: 'loading' } | { phase: 'error'; error: Error } | { phase: 'done'; m: MessageDetail };

/** `onChanged` gets the node's own reply after each change, for the list row. */
export function MessagePanel({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: (m: MessageDetail) => void }) {
  const [load, setLoad] = useState<Load>({ phase: 'loading' });
  const [busy, setBusy] = useState(false);
  // In a signal, not state: a sign-in that runs out mid-change unmounts this screen, and the
  // result line has to be there when it comes back.
  const note = messageNote.value?.id === id ? messageNote.value.text : null;
  const setNote = (text: string | null): void => { messageNote.value = text === null ? null : { id, text }; };
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const [error, setError] = useState<Error | undefined>();
  const [text, setText] = useState<{ phase: 'idle' } | { phase: 'loading' } | { phase: 'done'; text: string } | { phase: 'error'; error: Error }>({ phase: 'idle' });
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoad({ phase: 'loading' });
    setError(undefined);
    setText({ phase: 'idle' });
    setEditing(false);
    loadMessage(id).then((m) => { if (alive) setLoad({ phase: 'done', m }); }, (e: unknown) => { if (alive) setLoad({ phase: 'error', error: toError(e) }); });
    return () => { alive = false; };
  }, [id]);

  const act = async (what: string, run: () => Promise<Outcome<MessageDetail>>, done: (m: MessageDetail) => string) => {
    setBusy(true);
    setNote(null);
    setError(undefined);
    try {
      const out = await run();
      setNote(out.interrupted
        ? `The node's session ended as ${what} was sent, so it was not sent again. The node now shows status ${statusText(out.value.status)}.`
        : done(out.value));
      if (!alive.current) return;
      setLoad({ phase: 'done', m: out.value });
      onChanged(out.value);
      setEditing(false);
    } catch (e) {
      if (alive.current) setError(toError(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  const m = load.phase === 'done' ? load.m : null;
  const showText = async () => {
    if (!m) return;
    setText({ phase: 'loading' });
    try {
      setText({ phase: 'done', text: await readMessageText(m.id, m.size) });
    } catch (e) {
      setText({ phase: 'error', error: toError(e) });
    }
  };

  return (
    <Card title={`Message ${id}`} span={12} class="msg-panel">
      <div class="msg-actions">
        {m && m.status === 'H' && (
          <button type="button" class="btn primary" disabled={busy}
            onClick={() => void act('the release', () => setStatus(m, releaseStatus(m)), (r) => `Released. The node now shows status ${statusText(r.status)}.`)}>
            Release
          </button>
        )}
        {m && m.status !== 'H' && m.status !== 'K' && (
          <button type="button" class="btn" disabled={busy}
            onClick={() => void act('the hold', () => setStatus(m, 'H'), (r) => `Held. The node now shows status ${statusText(r.status)}.`)}>
            Hold
          </button>
        )}
        {m && m.status !== 'K' && (
          <ConfirmButton label="Kill" confirm={`Kill message ${m.id}? The BBS stops forwarding it and housekeeping removes it.`} busy={busy}
            onConfirm={() => void act('the kill', () => setStatus(m, 'K'), (r) => `Killed. The node now shows status ${statusText(r.status)}.`)} />
        )}
        {m && !editing && <button type="button" class="btn" disabled={busy} onClick={() => { setEditing(true); setNote(null); }}>Edit fields</button>}
        {m && <button type="button" class="btn" disabled={text.phase === 'loading'} onClick={() => void showText()}>{text.phase === 'done' ? 'Read text again' : 'Show text'}</button>}
        <button type="button" class="btn" onClick={onClose}>Close</button>
      </div>
      {note && <p class="mf-note" role="status">{note}</p>}
      {error && <ErrorNote error={error} />}
      {load.phase === 'loading' && <p><Skel /></p>}
      {load.phase === 'error' && <ErrorNote error={load.error} />}
      {m && (editing ? (
        <EditForm m={m} busy={busy} onCancel={() => setEditing(false)}
          onSave={(edit) => void act('the save', () => saveMessage(m, edit, 'all'), (r) => `Saved. The node now shows status ${statusText(r.status)}.`)} />
      ) : <Fields m={m} />)}
      {m && (
        <div class="msg-fwd">
          <h3>Forwarding</h3>
          {m.fwd.length === 0 ? <p class="muted">The node lists no forwarding partners for this message.</p> : (
            <table class="tbl">
              <thead><tr><th scope="col">Partner</th><th scope="col">State</th><th scope="col"><span class="sr-only">Change</span></th></tr></thead>
              <tbody>
                {m.fwd.map((c) => (
                  <tr key={c.bbs}>
                    <td class="mono">{c.call}</td>
                    <td>{FWD_NAME[c.state]}</td>
                    <td>
                      <button type="button" class="btn small" disabled={busy}
                        onClick={() => void act(`the change for ${c.call}`, () => stepForward(m, c.bbs),
                          (r) => `${c.call}: the node now shows ${FWD_NAME[r.fwd.find((x) => x.bbs === c.bbs)?.state ?? nextFwdState(c.state)].toLowerCase()}.`)}>
                        {`${STEP_LABEL[c.state]} ${c.call}`}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      {text.phase === 'loading' && <p><Skel /></p>}
      {text.phase === 'error' && <ErrorNote error={text.error} />}
      {text.phase === 'done' && (
        <div class="msg-text-wrap">
          <h3>Text</h3>
          <pre class="msg-text" aria-label={`Text of message ${id}`}>{text.text}</pre>
        </div>
      )}
    </Card>
  );
}
