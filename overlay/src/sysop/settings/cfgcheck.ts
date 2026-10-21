// Read bpq32.cfg the way linbpq's config.c does, closely enough to classify each line for the
// editor's highlighter and to catch the mistakes that stop a node or silently drop a line.

export type Severity = 'error' | 'warning';
export interface Issue { line: number; severity: Severity; message: string }

/** Where a line sits: the main section, a PORT block, the driver text after CONFIG, or a TNCPORT block. */
export type Section = 'main' | 'port' | 'driver' | 'tnc';

export type LineKind =
  | 'blank' | 'comment'
  | 'keyword' | 'unknown'
  | 'port' | 'endport'
  /** Free-form driver text between CONFIG and ENDPORT; the driver reads it, not config.c. */
  | 'driver'
  /** A line of a multi-line text block (IDMSG:, INFOMSG:, ...) and the *** that ends it. */
  | 'text' | 'textend';

export interface CfgLine {
  /** 1-based line number. */
  n: number;
  /** The line as written, without its CR. */
  text: string;
  kind: LineKind;
  section: Section;
  /** Upper-cased first word (up to = or a space), '' when there is none. */
  key: string;
  /** Offsets of the first word in `text`. */
  keyStart: number;
  keyEnd: number;
  /** Offset of the ; comment, or -1. */
  commentAt: number;
  /** Index of the PORT block this line belongs to (0-based, PORT and ENDPORT lines included), or null. */
  block: number | null;
}

// config.c keywords[]: matched as the whole first word.
const MAIN_WORDS = new Set([
  'OBSINIT', 'OBSMIN', 'NODESINTERVAL', 'L3TIMETOLIVE', 'L4RETRIES', 'L4TIMEOUT', 'BUFFERS', 'PACLEN',
  'TRANSDELAY', 'T3', 'IDLETIME', 'BBS', 'NODE', 'NODEALIAS', 'BBSALIAS', 'NODECALL', 'BBSCALL', 'TNCPORT',
  'IDMSG:', 'INFOMSG:', 'ROUTES:', 'PORT', 'MAXLINKS', 'MAXNODES', 'MAXROUTES', 'MAXCIRCUITS', 'IDINTERVAL',
  'MINQUAL', 'HIDENODES', 'L4DELAY', 'L4WINDOW', 'BTINTERVAL', 'UNPROTO', 'BBSQUAL', 'APPLICATIONS', 'EMS',
  'CTEXT:', 'DESQVIEW', 'HOSTINTERRUPT', 'ENABLE_LINKED', 'XXDEDHOST', 'FULL_CTEXT', 'SIMPLE', 'AUTOSAVE',
  'L4APPL', 'APPL1CALL', 'APPL2CALL', 'APPL3CALL', 'APPL4CALL', 'APPL5CALL', 'APPL6CALL', 'APPL7CALL',
  'APPL8CALL', 'APPL1ALIAS', 'APPL2ALIAS', 'APPL3ALIAS', 'APPL4ALIAS', 'APPL5ALIAS', 'APPL6ALIAS',
  'APPL7ALIAS', 'APPL8ALIAS', 'APPL1QUAL', 'APPL2QUAL', 'APPL3QUAL', 'APPL4QUAL', 'APPL5QUAL', 'APPL6QUAL',
  'APPL7QUAL', 'APPL8QUAL', 'BTEXT:', 'NETROMCALL', 'C_IS_CHAT', 'MAXRTT', 'MAXTT', 'MAXHOPS',
  'LOGL4CONNECTS', 'LOGALLCONNECTS', 'SAVEMH', 'ENABLEADIFLOG', 'ENABLEEVENTS', 'SAVEAPRSMSGS',
  'ENABLEM0LTEMAP', 'MQTT', 'MQTT_HOST', 'MQTT_PORT', 'MQTT_USER', 'MQTT_PASS', 'L4COMPRESS',
  'L4COMPMAXFRAME', 'L4COMPPACLEN', 'L2COMPRESS', 'L2COMPMAXFRAME', 'L2COMPPACLEN', 'PREFERINP3ROUTES',
  'ONLYVER2POINT0', 'DEBUGINP3', 'ENABLEOARCAPI', 'MONTOFILE', 'RIFINTERVAL', 'LOCALNOTSECURE',
]);

// decode_rec checks these as line prefixes before the table.
const MAIN_PREFIXES = [
  'NODEMAPSERVER=', 'CLOSEONERROR=', 'CHATMAPSERVER=', 'IPGATEWAY', 'PORTMAPPER', 'APRSDIGI', 'PASSWORD',
  'LINMAIL', 'LINCHAT', 'ENABLEAIS', 'ENABLEADSB', 'HFCTEXT', 'LOCATOR', 'MAPCOMMENT', 'BRIDGE', 'AGWPORT',
  'AGWSESSIONS', 'AGWMASK', 'AGWAPPL', 'AGWLOOPMON', 'AGWLOOPTX', 'APPLICATION ', 'APPLICATION=', 'EXCLUDE=',
  'RADIO', 'UPNP ', '#INCLUDE ',
];

/** Main-section keywords whose following lines, up to ***, are text. */
const TEXT_BLOCKS = new Set(['IDMSG:', 'INFOMSG:', 'CTEXT:', 'BTEXT:', 'ROUTES:', 'PORTMAPPER', 'APRSDIGI', 'RADIO']);

// config.c pkeywords[], plus CONFIG and XDIGI that decode_port_rec handles itself.
const PORT_WORDS = new Set([
  'ID', 'TYPE', 'PROTOCOL', 'IOADDR', 'INTLEVEL', 'SPEED', 'CHANNEL', 'BBSFLAG', 'QUALITY', 'MAXFRAME',
  'TXDELAY', 'SLOTTIME', 'PERSIST', 'FULLDUP', 'SOFTDCD', 'FRACK', 'RESPTIME', 'RETRIES', 'PACLEN', 'CWID',
  'PORTCALL', 'PORTALIAS', 'ENDPORT', 'VALIDCALLS', 'QUALADJUST', 'DIGIFLAG', 'DIGIPORT', 'USERS', 'UNPROTO',
  'PORTNUM', 'TXTAIL', 'ALIAS_IS_BBS', 'L3ONLY', 'KISSOPTIONS', 'INTERLOCK', 'NODESPACLEN', 'TXPORT',
  'MHEARD', 'CWIDTYPE', 'MINQUAL', 'MAXDIGIS', 'PORTALIAS2', 'DLLNAME', 'BCALL', 'DIGIMASK', 'NOKEEPALIVES',
  'COMPORT', 'DRIVER', 'WL2KREPORT', 'UIONLY', 'UDPPORT', 'IPADDR', 'I2CBUS', 'I2CDEVICE', 'UDPTXPORT',
  'UDPRXPORT', 'NONORMALIZE', 'IGNOREUNLOCKEDROUTES', 'INP3ONLY', 'TCPPORT', 'RIGPORT', 'PERMITTEDAPPLS',
  'HIDE', 'SMARTID', 'KISSCOMMAND', 'SENDTOM0LTEMAP', 'PORTFREQ', 'M0LTEMAPINFO', 'QTSMPORT', 'ALLOWINP3',
  'ENABLEINP3', 'ISRF', 'FREQ', 'BW', 'SF', 'CR', 'CONFIG', 'XDIGI',
]);

// TNCPORT blocks: tkeywords[] and the names decode_tnc_rec checks.
const TNC_WORDS = new Set([
  'COM', 'TYPE', 'APPLMASK', 'KISSMASK', 'APPLFLAGS', 'ENDPORT', 'COMPORT', 'APPLNUM', 'CHANNELS', 'STREAMS',
  'POLLDELAY', 'CONOK', 'AUTOLF', 'ECHO',
]);

/** GetNextLine keeps ; on these lines because their values need it. */
const KEEPS_SEMICOLON = /WebTermCSS|HybridCoLocatedRMS|HybridFrequencies/i;

function commentStart(text: string): number {
  return KEEPS_SEMICOLON.test(text) ? -1 : text.indexOf(';');
}

function firstWord(code: string): { key: string; start: number; end: number } {
  const m = /^[ \t]*([^=\s]*)/.exec(code) as RegExpExecArray;
  const start = m[0].length - (m[1] as string).length;
  return { key: (m[1] as string).toUpperCase(), start, end: m[0].length };
}

interface Scan { lines: CfgLine[]; issues: Issue[] }

function scan(text: string): Scan {
  const issues: Issue[] = [];
  const lines: CfgLine[] = [];
  let section: Section = 'main';
  let block: number | null = null;
  let blocks = 0;
  let open: { line: number; key: string } | null = null; // PORT or TNCPORT start
  let textBlock: { line: number; key: string; keepSemicolon: boolean } | null = null;
  let comment: number | null = null; // /* start line
  let nodecall = false;

  text.split('\n').forEach((raw, i) => {
    const n = i + 1;
    const t = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    const cAt = textBlock?.keepSemicolon ? -1 : commentStart(t);
    const code = (cAt >= 0 ? t.slice(0, cAt) : t).trim();
    const w = firstWord(cAt >= 0 ? t.slice(0, cAt) : t);
    const push = (kind: LineKind, inBlock = block) =>
      lines.push({ n, text: t, kind, section, key: w.key, keyStart: w.start, keyEnd: w.end, commentAt: cAt, block: inBlock });

    for (const ch of t) {
      if ((ch.codePointAt(0) as number) > 0xff) {
        issues.push({ line: n, severity: 'error', message: `Character "${ch}" cannot be sent to the node (not ISO-8859-1)` });
        break;
      }
    }

    // Block comments: a line starting /* opens one, a line starting */ closes it.
    if (comment !== null) {
      if (code.startsWith('*/')) comment = null;
      push('comment');
      return;
    }
    if (code.length > 1 && code.startsWith('/*')) {
      comment = n;
      push('comment');
      return;
    }

    if (textBlock) {
      if (code.startsWith('***')) {
        textBlock = null;
        push('textend');
      } else {
        push('text');
      }
      return;
    }

    if (!code) {
      push(cAt >= 0 ? 'comment' : 'blank');
      return;
    }

    const key = w.key;
    const startPort = (): void => {
      if (open) {
        issues.push({ line: n, severity: 'error', message: `PORT before the ENDPORT of the ${open.key} block on line ${open.line}` });
      }
      open = { line: n, key: 'PORT' };
      block = blocks++;
      section = 'port';
      push('port');
    };
    const endPort = (): void => {
      push('endport');
      open = null;
      block = null;
      section = 'main';
    };

    if (section === 'driver') {
      if (key.startsWith('ENDPORT')) endPort();
      else if (key === 'PORT') startPort();
      else push('driver');
      return;
    }

    if (section === 'port' || section === 'tnc') {
      if (key === 'ENDPORT') endPort();
      else if (key === 'PORT') startPort();
      else if (section === 'port' && key === 'CONFIG') {
        push('keyword');
        section = 'driver';
      } else if ((section === 'port' ? PORT_WORDS : TNC_WORDS).has(key)) push('keyword');
      else {
        issues.push({ line: n, severity: 'warning', message: `Unknown keyword "${w.key}"; the node ignores this line` });
        push('unknown');
      }
      return;
    }

    // Main section.
    if (key === 'PORT') return startPort();
    if (key === 'TNCPORT') {
      open = { line: n, key: 'TNCPORT' };
      section = 'tnc';
      push('port', null);
      return;
    }
    if (key === 'ENDPORT') {
      issues.push({ line: n, severity: 'error', message: 'ENDPORT without a PORT' });
      push('endport');
      return;
    }
    const upper = code.toUpperCase();
    const prefix = MAIN_PREFIXES.find((p) => upper.startsWith(p));
    if (!prefix && !MAIN_WORDS.has(key)) {
      issues.push({ line: n, severity: 'warning', message: `Unknown keyword "${w.key}"; the node ignores this line` });
      push('unknown');
      return;
    }
    if (key === 'NODECALL') nodecall = true;
    push('keyword');
    const ipGateway = upper.startsWith('IPGATEWAY') && upper[9] !== '=';
    if (TEXT_BLOCKS.has(key) || ipGateway || (prefix && TEXT_BLOCKS.has(prefix))) {
      textBlock = { line: n, key: ipGateway ? 'IPGATEWAY' : prefix ?? key, keepSemicolon: prefix === 'APRSDIGI' };
    }
  });

  const stillOpen = open as { line: number; key: string } | null;
  if (stillOpen) issues.push({ line: stillOpen.line, severity: 'error', message: `${stillOpen.key} block has no ENDPORT` });
  const stillText = textBlock as { line: number; key: string } | null;
  if (stillText) issues.push({ line: stillText.line, severity: 'error', message: `${stillText.key} block has no closing ***` });
  if (comment !== null) {
    issues.push({ line: comment, severity: 'warning', message: 'Comment block has no closing */; the rest of the file is ignored' });
  }
  if (!nodecall) issues.push({ line: 1, severity: 'error', message: 'No NODECALL line; the node will not start' });
  issues.sort((a, b) => a.line - b.line);
  return { lines, issues };
}

/** Every line, classified. */
export function scanCfg(text: string): CfgLine[] {
  return scan(text).lines;
}

/** Problems in order of line: errors stop a save, warnings do not. */
export function checkCfg(text: string): Issue[] {
  return scan(text).issues;
}
