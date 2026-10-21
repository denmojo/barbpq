// Structured edits to bpq32.cfg text. Each one reads the text, changes the fewest lines it can,
// and returns the new text; comments, spacing and line ends of the lines it does not touch stay as written.
import { scanCfg, type CfgLine } from './cfgcheck';

export interface PortBlock {
  /** PORTNUM=, or the block's place in the file when it has none (as config.c numbers it). */
  number: number;
  id: string | null;
  /** DRIVER=, else PROTOCOL=, else TYPE=; null when the block names none. */
  driver: string | null;
  txtail: number | null;
}

export interface Application {
  number: number;
  command: string;
  cmdAlias: string;
  call: string;
  alias: string;
  quality: string;
  l2alias: string;
}

/** A Telnet USER= line. The password is never read out of the text: it is always null here. */
export interface UserRecord {
  port: number;
  user: string;
  password: null;
  call: string;
  appl: string;
  sysop: boolean;
}

interface Lines { lines: string[]; info: CfgLine[] }

function split(text: string): Lines {
  return { lines: text.split('\n'), info: scanCfg(text) };
}

/** Replace a line's content, keeping its CR if it had one. */
function put(l: Lines, i: number, content: string): void {
  l.lines[i] = (l.lines[i] as string).endsWith('\r') ? `${content}\r` : content;
}

/** Insert a line after index i, with the same line end as the line before it. */
function insertAfter(l: Lines, i: number, content: string): void {
  const cr = (l.lines[i] ?? '').endsWith('\r') ? '\r' : '';
  l.lines.splice(i + 1, 0, content + cr);
}

/** The value after KEY= on a line, without its comment. */
function valueOf(line: CfgLine): string {
  const code = line.commentAt >= 0 ? line.text.slice(0, line.commentAt) : line.text;
  const eq = code.indexOf('=');
  return (eq >= 0 ? code.slice(eq + 1) : code.slice(line.keyEnd)).trim();
}

interface Block { index: number; number: number; lines: CfgLine[] }

function blocks(info: CfgLine[]): Block[] {
  const out: Block[] = [];
  for (const line of info) {
    if (line.block === null) continue;
    let b = out[line.block];
    if (!b) b = out[line.block] = { index: line.block, number: line.block + 1, lines: [] };
    b.lines.push(line);
  }
  for (const b of out) {
    const pn = b.lines.find((l) => l.section === 'port' && l.key === 'PORTNUM');
    const n = pn ? Number.parseInt(valueOf(pn), 10) : Number.NaN;
    if (Number.isFinite(n)) b.number = n;
  }
  return out;
}

const portKey = (b: Block, key: string): CfgLine | undefined =>
  b.lines.find((l) => l.section === 'port' && l.key === key);

export function listPorts(text: string): PortBlock[] {
  return blocks(scanCfg(text)).map((b) => {
    const v = (k: string) => { const l = portKey(b, k); return l ? valueOf(l) : null; };
    const tail = v('TXTAIL');
    const ms = tail === null ? Number.NaN : Number.parseInt(tail, 10);
    return {
      number: b.number,
      id: v('ID'),
      driver: (v('DRIVER') || v('PROTOCOL') || v('TYPE'))?.toUpperCase() ?? null,
      txtail: Number.isFinite(ms) ? ms : null,
    };
  });
}

function findBlock(l: Lines, port: number): Block {
  const b = blocks(l.info).find((x) => x.number === port);
  if (!b) throw new Error(`No PORT block with PORTNUM=${port}`);
  return b;
}

/** Set TXTAIL= in the PORT block numbered `port`, adding the line after PORTNUM= (or PORT) when missing. */
export function setTxtail(text: string, port: number, ms: number): string {
  if (!Number.isInteger(ms) || ms < 0) throw new Error('TXTAIL must be a whole number of milliseconds');
  const l = split(text);
  const b = findBlock(l, port);
  const tail = portKey(b, 'TXTAIL');
  if (tail) {
    const i = tail.n - 1;
    const t = tail.text;
    put(l, i, t.replace(/^(\s*TXTAIL\s*=?\s*)[^\s;]*/i, `$1${ms}`));
  } else {
    const after = portKey(b, 'PORTNUM') ?? (b.lines[0] as CfgLine);
    const next = b.lines.find((x) => x.n > after.n && x.kind !== 'blank');
    const indent = /^[ \t]*/.exec(next?.text ?? ' ')?.[0] ?? ' ';
    insertAfter(l, after.n - 1, `${indent}TXTAIL=${ms}`);
  }
  return l.lines.join('\n');
}

const APPL_RE = /^(\s*APPLICATION[ =]\s*)([^;]*?)(\s*(;.*)?)$/i;

function applFields(line: CfgLine): string[] | null {
  const m = APPL_RE.exec(line.text);
  return m ? (m[2] as string).split(',').map((s) => s.trim()) : null;
}

function applLines(info: CfgLine[]): { line: CfgLine; fields: string[] }[] {
  return info
    .filter((l) => l.section === 'main' && l.kind === 'keyword' && l.key === 'APPLICATION')
    .flatMap((line) => { const fields = applFields(line); return fields ? [{ line, fields }] : []; });
}

export function listApplications(text: string): Application[] {
  return applLines(scanCfg(text)).map(({ fields: f }) => ({
    number: Number.parseInt(f[0] ?? '', 10),
    command: f[1] ?? '',
    cmdAlias: f[2] ?? '',
    call: f[3] ?? '',
    alias: f[4] ?? '',
    quality: f[5] ?? '',
    l2alias: f[6] ?? '',
  }));
}

function noSeparators(what: string, v: string): void {
  if (v.includes(',')) throw new Error(`${what} cannot contain a comma`);
  if (v.includes(';')) throw new Error(`${what} cannot contain a semicolon`);
}

/** Rewrite APPLICATION n (matched by number), or add it after the last APPLICATION line. */
export function setApplication(text: string, app: Application): string {
  if (!Number.isInteger(app.number) || app.number < 1) throw new Error('Application number must be 1 or more');
  if (!app.command.trim()) throw new Error('Application needs a command');
  const parts = [app.command, app.cmdAlias, app.call, app.alias, app.quality, app.l2alias].map((s) => s.trim());
  parts.forEach((p) => noSeparators('An application field', p));
  const fields = [String(app.number), ...parts];
  while (fields.length > 2 && fields[fields.length - 1] === '') fields.pop();
  const body = fields.join(',');

  const l = split(text);
  const all = applLines(l.info);
  const hit = all.find((a) => Number.parseInt(a.fields[0] ?? '', 10) === app.number);
  if (hit) {
    const m = APPL_RE.exec(hit.line.text) as RegExpExecArray;
    // Keep the line byte for byte when nothing changed (spacing after commas included).
    if ((m[2] as string).split(',').map((s) => s.trim()).join(',').replace(/,+$/, '') === body) return text;
    put(l, hit.line.n - 1, `${m[1]}${body}${m[3]}`);
    return l.lines.join('\n');
  }
  const last = all[all.length - 1];
  if (last) {
    insertAfter(l, last.line.n - 1, `APPLICATION ${body}`);
  } else {
    // No APPLICATION lines yet: add at the end, before the final newline.
    const end = l.lines[l.lines.length - 1] === '' ? l.lines.length - 2 : l.lines.length - 1;
    insertAfter(l, end, `APPLICATION ${body}`);
  }
  return l.lines.join('\n');
}

interface UserLine { line: CfgLine; port: number; fields: string[] }

/** USER= lines in the CONFIG text of DRIVER=TELNET ports, split the way TelnetV6.c splits them. */
function userLines(info: CfgLine[]): UserLine[] {
  const out: UserLine[] = [];
  for (const b of blocks(info)) {
    const drv = portKey(b, 'DRIVER');
    if (!drv || valueOf(drv).toUpperCase() !== 'TELNET') continue;
    for (const line of b.lines) {
      if (line.kind !== 'driver' || !/^\s*USER[= ]/i.test(line.text)) continue;
      const value = line.text.replace(/^\s*USER[= ]/i, '').split(';')[0] as string;
      const fields = value.split(',').map((s) => s.trim().split(' ')[0] as string);
      out.push({ line, port: b.number, fields });
    }
  }
  return out;
}

const toRecord = (u: UserLine): UserRecord => ({
  port: u.port,
  user: u.fields[0] ?? '',
  password: null,
  call: (u.fields[2] ?? '').toUpperCase(),
  appl: u.fields[3] ?? '',
  sysop: (u.fields[4] ?? '').toUpperCase() === 'SYSOP',
});

export function listUsers(text: string): UserRecord[] {
  return userLines(scanCfg(text)).map(toRecord);
}

function userField(what: string, v: string): void {
  noSeparators(what, v);
  if (/\s/.test(v)) throw new Error(`${what} cannot contain a space`);
}

/**
 * Rewrite the user's USER= line (matched by port and user name, any case) or add one after the
 * port's last USER line. The stored password stays unless `password` is given; a new user needs one.
 */
export function setUser(text: string, rec: UserRecord, password?: string): string {
  const user = rec.user.trim();
  const call = rec.call.trim().toUpperCase();
  const appl = rec.appl.trim();
  if (!user) throw new Error('User needs a name');
  if (!call) throw new Error('User needs a callsign');
  userField('User name', user);
  userField('Callsign', call);
  userField('Application', appl);
  if (password !== undefined) {
    if (!password) throw new Error('Password cannot be empty');
    userField('Password', password);
  }

  const l = split(text);
  const all = userLines(l.info);
  const hit = all.find((u) => u.port === rec.port && (u.fields[0] ?? '').toLowerCase() === user.toLowerCase());
  const build = (pw: string) => {
    const f = [user, pw, call, appl, rec.sysop ? 'SYSOP' : ''];
    while (f.length > 3 && f[f.length - 1] === '') f.pop();
    return `USER=${f.join(',')}`;
  };
  if (hit) {
    const old = hit.fields;
    const pw = password ?? old[1] ?? '';
    const same = password === undefined && toRecord(hit).call === call && (old[3] ?? '') === appl
      && toRecord(hit).sysop === rec.sysop && old[0] === user;
    if (same) return text;
    const m = /^(\s*)[^;]*?(\s*(;.*)?)$/.exec(hit.line.text) as RegExpExecArray;
    put(l, hit.line.n - 1, `${m[1]}${build(pw)}${m[2]}`);
    return l.lines.join('\n');
  }
  if (!password) throw new Error(`New user ${user} needs a password`);
  const b = blocks(l.info).find((x) => x.number === rec.port);
  const drv = b && portKey(b, 'DRIVER');
  if (!b || !drv || valueOf(drv).toUpperCase() !== 'TELNET') throw new Error(`Port ${rec.port} is not a Telnet port`);
  const mine = all.filter((u) => u.port === rec.port);
  const lastUser = mine[mine.length - 1];
  if (lastUser) {
    const indent = /^[ \t]*/.exec(lastUser.line.text)?.[0] ?? ' ';
    insertAfter(l, lastUser.line.n - 1, `${indent}${build(password)}`);
  } else {
    const end = b.lines.find((x) => x.kind === 'endport');
    const configLine = b.lines.find((x) => x.key === 'CONFIG');
    if (!configLine) throw new Error(`Port ${rec.port} has no CONFIG section for users`);
    const at = (end ? end.n - 1 : configLine.n) - 1;
    insertAfter(l, at, ` ${build(password)}`);
  }
  return l.lines.join('\n');
}
