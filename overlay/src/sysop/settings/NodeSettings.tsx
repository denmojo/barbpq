// SysOp Settings: bpq32.cfg through the raw editor or structured forms, one draft, one Save.
// The forms edit the draft text; nothing reaches the node until Save. No restart is ever sent.
import { useEffect, useMemo, useState } from 'preact/hooks';
import { CFG_SAVE_LIMIT, encodeCfgSave } from '../../data/forms';
import { Card } from '../../ui/Card';
import { ErrorNote } from '../../ui/ErrorNote';
import { Skel } from '../../ui/Skel';
import { Tabs } from '../../ui/Tabs';
import { Unknown } from '../../ui/Unknown';
import { Footer } from '../../public/Footer';
import { registerPaletteItems } from '../palette';
import { checkCfg } from './cfgcheck';
import {
  listApplications, listPorts, listUsers, setApplication, setTxtail, setUser,
  type Application, type PortBlock, type UserRecord,
} from './cfgforms';
import { changeSummary, ConfigEditor, lineDiff } from './ConfigEditor';
import {
  cfgDraft, cfgLoad, cfgLoaded, cfgSave, discardDraft, editDraft, loadConfig, restartNeeded, saveDraft,
  settingsTab, type SettingsTab,
} from './draft';
import { RestartBanner } from './RestartBanner';
import './settings.css';

const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'file', label: 'Config file' },
  { id: 'ports', label: 'Ports' },
  { id: 'apps', label: 'Applications' },
  { id: 'users', label: 'Telnet users' },
];

/** Command palette entries for the Settings screen and its forms. */
export function useSettingsPalette(): void {
  useEffect(() => {
    const open = (tab: SettingsTab) => () => { settingsTab.value = tab; };
    return registerPaletteItems([
      { label: 'Edit bpq32.cfg', route: 'settings', action: open('file'), group: 'Settings', keywords: 'config text raw editor check' },
      { label: 'Port TXTAIL', route: 'settings', action: open('ports'), group: 'Settings', keywords: 'ports tail kiss timing' },
      { label: 'Applications', route: 'settings', action: open('apps'), group: 'Settings', keywords: 'application rms bbs chat command' },
      { label: 'Telnet users', route: 'settings', action: open('users'), group: 'Settings', keywords: 'user password sysop login' },
    ]);
  }, []);
}

/** Bytes the save request would carry, or null when the text cannot be encoded (checkCfg reports why). */
function bodySize(text: string): number | null {
  try {
    return encodeCfgSave(text).length;
  } catch {
    return null;
  }
}

const fmt = (n: number): string => n.toLocaleString('en-US');

function apply(edit: (text: string) => string): string | null {
  const text = cfgDraft.peek();
  if (text === null) return 'The config is not loaded';
  try {
    editDraft(edit(text));
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

function FormError({ message }: { message: string | null }) {
  return message ? <div class="form-err" role="alert">{message}</div> : null;
}

function PortRow({ port }: { port: PortBlock }) {
  const [ms, setMs] = useState(port.txtail === null ? '' : String(port.txtail));
  const [err, setErr] = useState<string | null>(null);
  const n = port.number;
  const value = ms.trim() === '' ? null : Number(ms);
  const unchanged = value === port.txtail;
  return (
    <tr>
      <td class="mono">{n}</td>
      <td>{port.id ?? <Unknown reason="No ID= line in this PORT block" />}</td>
      <td class="mono">{port.driver ?? <Unknown reason="No DRIVER=, PROTOCOL= or TYPE= line in this PORT block" />}</td>
      <td>
        <input class="num" type="number" min={0} step={1} inputMode="numeric" aria-label={`TXTAIL for port ${n} (ms)`}
          placeholder="Not set" value={ms} onInput={(e) => { setMs((e.currentTarget as HTMLInputElement).value); setErr(null); }} />
        <FormError message={err} />
      </td>
      <td class="r">
        <button type="button" class="btn small" aria-label={`Apply TXTAIL for port ${n}`} disabled={value === null || unchanged}
          onClick={() => value !== null && setErr(apply((t) => setTxtail(t, n, value)))}>Apply</button>
      </td>
    </tr>
  );
}

function PortsForm({ text }: { text: string }) {
  const ports = useMemo(() => listPorts(text), [text]);
  return (
    <Card title="Ports" span={12}>
      <p class="muted form-hint">TXTAIL is how long the radio keeps transmitting after a frame, in milliseconds.</p>
      {ports.length === 0 ? <p class="muted">No PORT blocks in bpq32.cfg.</p> : (
        <div class="table-wrap">
          <table class="tbl form-tbl">
            <thead><tr><th>Port</th><th>ID</th><th>Driver</th><th>TXTAIL (ms)</th><th class="r"><span class="sr-only">Apply</span></th></tr></thead>
            <tbody>{ports.map((p) => <PortRow key={`${p.number}:${p.txtail ?? ''}`} port={p} />)}</tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

const APP_FIELDS: { key: keyof Omit<Application, 'number' | 'l2alias'>; label: string }[] = [
  { key: 'command', label: 'Command' },
  { key: 'cmdAlias', label: 'Command alias' },
  { key: 'call', label: 'Call' },
  { key: 'alias', label: 'Alias' },
  { key: 'quality', label: 'Quality' },
];

function AppRow({ app, isNew }: { app: Application; isNew: boolean }) {
  const [v, setV] = useState(app);
  const [err, setErr] = useState<string | null>(null);
  const n = app.number;
  const unchanged = APP_FIELDS.every((f) => v[f.key] === app[f.key]);
  return (
    <tr class={isNew ? 'new-row' : undefined}>
      <td class="mono">{n}</td>
      {APP_FIELDS.map((f) => (
        <td key={f.key}>
          <input type="text" class={f.key === 'quality' ? 'num' : undefined} aria-label={`${f.label} for application ${n}`} spellcheck={false}
            placeholder={isNew && f.key === 'command' ? 'New command' : ''} value={v[f.key]}
            onInput={(e) => { setV({ ...v, [f.key]: (e.currentTarget as HTMLInputElement).value }); setErr(null); }} />
        </td>
      ))}
      <td class="r">
        <button type="button" class="btn small" aria-label={`${isNew ? 'Add' : 'Apply'} application ${n}`}
          disabled={unchanged || (isNew && !v.command.trim())}
          onClick={() => setErr(apply((t) => setApplication(t, v)))}>{isNew ? 'Add' : 'Apply'}</button>
        <FormError message={err} />
      </td>
    </tr>
  );
}

function AppsForm({ text }: { text: string }) {
  const apps = useMemo(() => listApplications(text), [text]);
  const next = apps.reduce((m, a) => (Number.isFinite(a.number) ? Math.max(m, a.number) : m), 0) + 1;
  const blank: Application = { number: next, command: '', cmdAlias: '', call: '', alias: '', quality: '', l2alias: '' };
  return (
    <Card title="Applications" span={12}>
      <p class="muted form-hint">APPLICATION lines: the command a caller types, what it runs, and the call and alias the node answers to for it.</p>
      <div class="table-wrap">
        <table class="tbl form-tbl">
          <thead><tr><th>No.</th>{APP_FIELDS.map((f) => <th key={f.key}>{f.label}</th>)}<th class="r"><span class="sr-only">Apply</span></th></tr></thead>
          <tbody>
            {apps.map((a) => <AppRow key={JSON.stringify(a)} app={a} isNew={false} />)}
            <AppRow key={`new:${next}`} app={blank} isNew />
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** One USER= line. The password field starts empty; the stored one is never read into the page. */
function UserRow({ rec }: { rec: UserRecord }) {
  const [call, setCall] = useState(rec.call);
  const [appl, setAppl] = useState(rec.appl);
  const [isSysop, setSysop] = useState(rec.sysop);
  const [pw, setPw] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const u = rec.user;
  const unchanged = call === rec.call && appl === rec.appl && isSysop === rec.sysop && pw === '';
  const onApply = (): void => {
    const next = { ...rec, call, appl, sysop: isSysop };
    setErr(apply((t) => setUser(t, next, pw === '' ? undefined : pw)));
    setPw('');
  };
  return (
    <tr>
      <td class="mono">{rec.port}</td>
      <td class="mono">{u}</td>
      <td><input type="text" spellcheck={false} aria-label={`Callsign for ${u}`} value={call} onInput={(e) => setCall((e.currentTarget as HTMLInputElement).value)} /></td>
      <td><input type="text" spellcheck={false} aria-label={`Application for ${u}`} value={appl} onInput={(e) => setAppl((e.currentTarget as HTMLInputElement).value)} /></td>
      <td class="c"><input type="checkbox" aria-label={`SYSOP for ${u}`} checked={isSysop} onChange={(e) => setSysop((e.currentTarget as HTMLInputElement).checked)} /></td>
      <td>
        <input type="password" autocomplete="new-password" aria-label={`New password for ${u}`} placeholder="Unchanged"
          value={pw} onInput={(e) => setPw((e.currentTarget as HTMLInputElement).value)} />
        <FormError message={err} />
      </td>
      <td class="r"><button type="button" class="btn small" aria-label={`Apply user ${u}`} disabled={unchanged} onClick={onApply}>Apply</button></td>
    </tr>
  );
}

function NewUserRow({ ports }: { ports: number[] }) {
  const [port, setPort] = useState(ports[0] as number);
  const [user, setUserName] = useState('');
  const [call, setCall] = useState('');
  const [appl, setAppl] = useState('');
  const [isSysop, setSysop] = useState(false);
  const [pw, setPw] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const onAdd = (): void => {
    const e = apply((t) => setUser(t, { port, user, password: null, call, appl, sysop: isSysop }, pw));
    setErr(e);
    setPw('');
    if (!e) { setUserName(''); setCall(''); setAppl(''); setSysop(false); }
  };
  return (
    <tr class="new-row">
      <td>
        {ports.length > 1 ? (
          <select aria-label="Port for the new user" value={port} onChange={(e) => setPort(Number((e.currentTarget as HTMLSelectElement).value))}>
            {ports.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        ) : <span class="mono">{port}</span>}
      </td>
      <td><input type="text" spellcheck={false} aria-label="New user name" placeholder="New user" value={user} onInput={(e) => setUserName((e.currentTarget as HTMLInputElement).value)} /></td>
      <td><input type="text" spellcheck={false} aria-label="Callsign for the new user" value={call} onInput={(e) => setCall((e.currentTarget as HTMLInputElement).value)} /></td>
      <td><input type="text" spellcheck={false} aria-label="Application for the new user" value={appl} onInput={(e) => setAppl((e.currentTarget as HTMLInputElement).value)} /></td>
      <td class="c"><input type="checkbox" aria-label="SYSOP for the new user" checked={isSysop} onChange={(e) => setSysop((e.currentTarget as HTMLInputElement).checked)} /></td>
      <td>
        <input type="password" autocomplete="new-password" aria-label="Password for the new user" placeholder="Required"
          value={pw} onInput={(e) => setPw((e.currentTarget as HTMLInputElement).value)} />
        <FormError message={err} />
      </td>
      <td class="r"><button type="button" class="btn small" disabled={!user.trim() || !call.trim() || !pw} onClick={onAdd}>Add user</button></td>
    </tr>
  );
}

function UsersForm({ text }: { text: string }) {
  const users = useMemo(() => listUsers(text), [text]);
  const telnet = useMemo(() => listPorts(text).filter((p) => p.driver === 'TELNET').map((p) => p.number), [text]);
  return (
    <Card title="Telnet users" span={12}>
      <p class="muted form-hint">USER lines of the Telnet port. Passwords are not shown; type a new one only to change it.</p>
      {telnet.length === 0 ? <p class="muted">No Telnet port (DRIVER=TELNET) in bpq32.cfg.</p> : (
        <div class="table-wrap">
          <table class="tbl form-tbl">
            <thead><tr><th>Port</th><th>User</th><th>Callsign</th><th>Application</th><th class="c">SYSOP</th><th>Password</th><th class="r"><span class="sr-only">Apply</span></th></tr></thead>
            <tbody>
              {users.map((r) => <UserRow key={`${r.port}:${r.user}:${r.call}:${r.appl}:${r.sysop ? 1 : 0}`} rec={r} />)}
              <NewUserRow ports={telnet} />
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export function NodeSettings() {
  useEffect(() => {
    if (cfgLoaded.peek() === null && !cfgLoad.peek().busy) void loadConfig();
  }, []);
  const loaded = cfgLoaded.value;
  const draft = cfgDraft.value;
  const load = cfgLoad.value;
  const save = cfgSave.value;
  const tab = settingsTab.value;

  const issues = useMemo(() => (draft === null ? [] : checkCfg(draft)), [draft]);
  const changes = useMemo(() => (draft === null || loaded === null ? 'No changes' : changeSummary(lineDiff(loaded, draft))), [loaded, draft]);
  const size = useMemo(() => (draft === null ? null : bodySize(draft)), [draft]);
  const errors = issues.filter((i) => i.severity === 'error').length;
  const tooLarge = size !== null && size > CFG_SAVE_LIMIT;
  const dirty = draft !== null && draft !== loaded;
  const saving = save.kind === 'saving';
  const canSave = dirty && errors === 0 && !tooLarge && !saving;

  return (
    <>
      <div class="titlebar">
        <h1>Settings</h1>
        {draft !== null && <span class="sub">bpq32.cfg · <span>{changes}</span></span>}
        {draft !== null && (
          <div class="title-actions">
            <button type="button" class="btn" disabled={!dirty || saving} onClick={discardDraft}>Discard changes</button>
            <button type="button" class="btn primary" disabled={!canSave} onClick={() => { void saveDraft(); }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}
      </div>
      {restartNeeded.value && <RestartBanner />}
      {tooLarge && (
        <div class="errnote" role="alert">
          <span class="errdot" aria-hidden="true" />
          <span>{`Config too large to save through the node (${fmt(size)} bytes, limit ${fmt(CFG_SAVE_LIMIT)})`}</span>
        </div>
      )}
      {save.kind === 'failed' && <ErrorNote error={save.error} />}
      {draft !== null && errors > 0 && tab !== 'file' && (
        <div class="errnote" role="status">
          <span class="errdot" aria-hidden="true" />
          <span>The config has {errors} {errors === 1 ? 'error' : 'errors'}; open Config file to fix {errors === 1 ? 'it' : 'them'} before saving.</span>
        </div>
      )}

      {draft === null || loaded === null ? (
        <div class="grid">
          <Card title="bpq32.cfg" span={12}>
            {load.error ? (
              <>
                <ErrorNote error={load.error} />
                <button type="button" class="btn" onClick={() => { void loadConfig(); }}>Try again</button>
              </>
            ) : <Skel />}
          </Card>
        </div>
      ) : (
        <>
          <Tabs items={TABS} value={tab} onChange={(id) => { settingsTab.value = id as SettingsTab; }} label="Settings sections" />
          <div class="grid settings-grid">
            {tab === 'file' && <ConfigEditor value={draft} original={loaded} issues={issues} onInput={editDraft} />}
            {tab === 'ports' && <PortsForm text={draft} />}
            {tab === 'apps' && <AppsForm text={draft} />}
            {tab === 'users' && <UsersForm text={draft} />}
          </div>
        </>
      )}
      <Footer />
    </>
  );
}
