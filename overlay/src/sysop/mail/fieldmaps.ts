// Labels and grouping for the mail forms. Names are the old pages' field names, as the
// handlers in BBSHTMLConfig.c read them; labels follow the handlers and the old page text.
// A field no map names still renders, under "Other settings", so every field stays editable.

export type MailPage = 'conf' | 'fwd' | 'user' | 'hk' | 'wel' | 'wp';

export interface MappedField {
  name: string;
  label: string;
  help?: string;
  /** Match only fields of this type (the Conf page has a radio and five text fields named Type). */
  type?: string;
  /** Match only this occurrence of a repeated name (counted over every field of that name). */
  index?: number;
  /** Shown but not editable: the node's save does not read it. */
  readOnly?: boolean;
  /** Labels for radio or select options, by value. */
  options?: Record<string, string>;
  rows?: number;
}

export interface FieldGroup {
  label: string;
  help?: string;
  fields: MappedField[];
  /** Repeated rows of the same fields (the FBB filter lines): a table, one column per field. */
  table?: boolean;
}

const f = (name: string, label: string, more: Omit<MappedField, 'name' | 'label'> = {}): MappedField => ({ name, label, ...more });

const LISTS = 'One entry per line.';

const MAPS: Record<MailPage, FieldGroup[]> = {
  conf: [
    {
      label: 'BBS identity',
      fields: [
        f('BBSCall', 'BBS call'), f('SYSOPCall', 'SYSOP call'),
        f('HRoute', 'Hierarchical route', { help: 'The BBS address after the call, e.g. #NCA.CA.USA.NOAM' }),
        f('ApplNum', 'BBS application number', { help: 'The APPLICATION number in bpq32.cfg that runs the BBS' }),
        f('Streams', 'Streams', { help: 'How many users can be connected at once' }),
      ],
    },
    {
      label: 'Users and messages',
      fields: [
        f('BBSToSYSOP', 'Redirect messages for the BBS call to the SYSOP call'),
        f('SysToSYSOP', 'Send system messages to the SYSOP call'),
        f('RefuseBulls', 'Refuse bulletins'),
        f('DontHold', "Don't hold messages from new users"),
        f('DefaultNoWinlink', "New users: don't add the winlink.org flag"),
        f('DontNeedName', "Don't ask for a name"),
        f('DontNeedHomeBBS', "Don't ask for a home BBS"),
        f('DontCheckFromCall', "Don't check the From call"),
        f('UserCantKillT', 'Allow users to kill T messages'),
        f('FWDtoMe', 'Forward messages to the BBS call'),
        f('OnlyKnown', "Don't allow unknown users"),
        f('Events', 'Enable event reporting'),
      ],
    },
    {
      label: 'FBB UI',
      fields: [f('EnUI', 'Enable the FBB UI system'), f('UIInterval', 'Send Mail For beacons every (minutes)')],
    },
    {
      label: 'Network ports',
      help: '0 turns a service off.',
      fields: [
        f('POP3Port', 'POP3 port'), f('SMTPPort', 'SMTP port'), f('NNTPPort', 'NNTP port'),
        f('EnRemote', 'Enable remote access'),
        f('AMPRDomain', 'AMPR address'), f('SendAMPR', 'Send AMPR mail to the AMPR host'),
      ],
    },
    {
      label: 'ISP gateway',
      fields: [
        f('EnISP', 'Enable the ISP interface'), f('ISPDomain', 'My domain'),
        f('SMTPServer', 'SMTP server'), f('ISPSMTPPort', 'SMTP server port'), f('ISPEHLOName', 'SMTP domain (EHLO name)'),
        f('POP3Server', 'POP3 server'), f('ISPPOP3Port', 'POP3 server port'),
        f('ISPAccount', 'Account name'), f('ISPPassword', 'Password'),
        f('PollInterval', 'POP3 poll interval'), f('ISPAuth', 'SMTP server requires authentication'),
      ],
    },
    {
      label: 'White pages',
      fields: [
        f('EnWP', 'Send WP updates'), f('RejWFBulls', 'Reject WP bulletins'),
        f('Type', 'WP update type', { type: 'radio', options: { TypeB: 'Type B', TypeP: 'Type P' } }),
        f('WPTO', 'WP destinations', { help: LISTS }),
      ],
    },
    {
      label: 'Message filters',
      help: `${LISTS} Calls, @BBS routes or BIDs to reject or hold.`,
      fields: [
        f('Rfrom', 'Reject from'), f('Rto', 'Reject to'), f('Rat', 'Reject at'), f('RBID', 'Reject BID'),
        f('Hfrom', 'Hold from'), f('Hto', 'Hold to'), f('Hat', 'Hold at'), f('HBID', 'Hold BID'),
      ],
    },
    {
      label: 'FBB reject.sys filters',
      help: 'Every field must match; wildcards allowed. Action R rejects, H holds, A accepts without checking later lines.',
      table: true,
      fields: [
        f('Action', 'Action'), f('Type', 'Type', { type: 'text' }), f('From', 'From'), f('TO', 'To'),
        f('AT', '@BBS'), f('BID', 'BID'), f('MaxLen', 'Max size'),
      ],
    },
  ],

  // Both forwarding forms: the shared settings (FwdCommon) and one partner's record (FWDSave).
  fwd: [
    {
      label: 'Limits',
      fields: [
        f('MaxTX', 'Max size to send'), f('MaxRX', 'Max size to receive'), f('MaxAge', 'Max age for bulletins (days)'),
      ],
    },
    {
      label: 'Options',
      fields: [
        f('WarnNoRoute', 'Warn if there is no route for P or T'), f('LocalTime', 'Use local time'),
        f('SendPtoMultiple', 'Send P messages to more than one BBS'), f('FourCharCont', 'Use 4-character continent codes'),
      ],
    },
    { label: 'Aliases', help: LISTS, fields: [f('Aliases', 'Aliases', { rows: 6 })] },
    {
      label: 'Schedule',
      fields: [
        f('EnF', 'Enable forwarding'), f('Interval', 'Interval (seconds)'),
        f('EnR', 'Request reverse forwarding'), f('RInterval', 'Reverse interval (seconds)'),
        f('NoWait', 'Send new messages without waiting for the poll timer'),
        f('ConTimeOut', 'Incoming connect timeout (seconds)'),
      ],
    },
    {
      label: 'Connect script',
      help: 'One command per line. ELSE starts the next way to try.',
      fields: [f('FWD', 'Connect script', { rows: 8 })],
    },
    {
      label: 'Routing',
      help: LISTS,
      fields: [
        f('TO', 'TO calls'), f('AT', 'AT routes'), f('Times', 'Times'),
        f('HRB', 'Hierarchical routes (flood bulletins)'), f('HRP', 'HR (personals and directed bulletins)'),
        f('BBSHA', 'BBS hierarchical address'),
      ],
    },
    {
      label: 'Protocol',
      fields: [
        f('Blocked', 'FBB blocked'), f('FBBBlock', 'Max block size'), f('Personal', 'Send personal mail only'),
        f('Bin', 'Allow binary'), f('B1', 'Use B1 protocol'), f('B2', 'Use B2 protocol'),
        f('CTRLZ', 'Send Ctrl-Z instead of /ex in text mode'),
      ],
    },
  ],

  user: [
    {
      label: 'Account',
      fields: [
        f('Name', 'Name'), f('Password', 'BBS password'),
        f('CMSPass', 'CMS password', { help: 'The node shows it as stars; leave it untouched to keep it' }),
        f('QTH', 'QTH'), f('ZIP', 'ZIP'), f('HomeBBS', 'Home BBS'), f('LastListed', 'Last listed message'),
      ],
    },
    {
      label: 'Role',
      fields: [
        f('BBS', 'BBS (forwarding partner)'), f('SYSOP', 'SYSOP'), f('PMS', 'PMS'), f('Expert', 'Expert'),
        f('PermitEmail', 'Permit email'), f('Excluded', 'Excluded'), f('Hold', 'Hold messages'),
      ],
    },
    {
      label: 'Winlink and RMS',
      fields: [
        f('RMSExUser', 'RMS Express user'), f('PollRMS', 'Poll RMS'),
        f('SSID1', 'Poll RMS for SSID (1)'), f('SSID2', 'Poll RMS for SSID (2)'),
        f('SSID3', 'Poll RMS for SSID (3)'), f('SSID4', 'Poll RMS for SSID (4)'),
        f('NOWINLINK', "Don't add @winlink.org"), f('RMSREDIR', 'Redirect to RMS'),
        f('APRSMFOR', 'Send APRS Mail For'), f('APRSSSID', 'APRS Mail For SSID'),
      ],
    },
    {
      label: 'Messages',
      fields: [
        f('SYSOPLM', 'Include SYSOP messages in LM'), f('ALLOWBULLS', 'Allow sending bulletins'),
        f('NTSMPS', 'NTS message pickup station'),
      ],
    },
  ],

  hk: [
    {
      label: 'Schedule',
      fields: [f('MTTime', 'Maintenance time (UTC, HHMM)'), f('MTInt', 'Maintenance interval (hours)')],
    },
    {
      label: 'Limits',
      fields: [
        f('MAXMSG', 'Max message number'), f('BIDLife', 'BID lifetime (days)'),
        f('LogLife', 'Log file lifetime (days)'), f('UserLife', 'Delete inactive users after (days)', { help: '0 keeps them' }),
      ],
    },
    {
      label: 'Options',
      fields: [
        f('Deltobin', 'Delete messages and logs to the recycle bin'),
        f('SendND', 'Send non-delivery notices for P and T messages'),
        f('NoMail', "Don't mail the housekeeping result"),
        f('GenTraffic', 'Generate a traffic report'),
      ],
    },
    {
      label: 'Personal lifetimes (days)',
      fields: [f('PR', 'Read'), f('PUR', 'Unread'), f('PF', 'Forwarded'), f('PUF', 'Unforwarded')],
    },
    { label: 'Bulletin lifetimes (days)', fields: [f('BF', 'Forwarded'), f('BUF', 'Unforwarded')] },
    { label: 'NTS lifetimes (days)', fields: [f('NTSD', 'Delivered'), f('NTSF', 'Forwarded'), f('NTSU', 'Unforwarded')] },
    {
      label: 'Bulletin overrides',
      help: 'One per line: call, lifetime in days, e.g. ALL, 10. These apply to sent bulletins unless the box below is ticked.',
      fields: [
        f('From', 'From overrides'), f('To', 'To overrides'), f('At', 'At overrides'),
        f('OvUnsent', 'Apply overrides to unsent bulletins'),
      ],
    },
  ],

  wel: [
    {
      label: 'Welcome messages',
      help: '$U call, $I first name, $X messages for the user, $x unread, $L latest message, $N active messages, $Z last read. The node keeps the old text if a box is left empty.',
      fields: [
        f('NUWelcome', 'Normal user welcome', { rows: 3 }), f('NewWelcome', 'New user welcome', { rows: 3 }),
        f('ExWelcome', 'Expert user welcome', { rows: 3 }),
      ],
    },
    {
      label: 'Prompts',
      fields: [
        f('NUPrompt', 'Normal user prompt', { rows: 2 }), f('NewPrompt', 'New user prompt', { rows: 2 }),
        f('ExPrompt', 'Expert user prompt', { rows: 2 }),
      ],
    },
    { label: 'Sign-off', fields: [f('Bye', 'Sign-off message', { rows: 2 })] },
  ],

  wp: [
    {
      label: 'White pages record',
      fields: [
        f('Name', 'Name'), f('Home1', 'Home BBS 1'), f('Home2', 'Home BBS 2'),
        f('QTH1', 'QTH 1'), f('QTH2', 'QTH 2'), f('ZIP1', 'ZIP 1'), f('ZIP2', 'ZIP 2'),
      ],
    },
    {
      label: 'Record status',
      help: 'The node sets these itself; a save does not change them.',
      fields: [
        f('Seen', 'Last seen', { index: 0, readOnly: true }), f('Modif', 'Last modified', { readOnly: true }),
        f('Type', 'Type', { readOnly: true }), f('Changed', 'Changed', { readOnly: true }),
        f('Seen', 'Seen', { index: 1, readOnly: true }),
      ],
    },
  ],
};

export function fieldMap(page: MailPage): FieldGroup[] {
  return MAPS[page];
}

/** Fields the old page reads only for a button (copy from a BBS, add a user); the screen shows them by that button. */
export const ACTION_FIELDS: Record<MailPage, string[]> = {
  conf: [], fwd: ['CopyCall'], user: ['NewCall'], hk: [], wel: [], wp: [],
};

/** Password fields by name (the old pages draw them as plain text inputs). */
export const SECRET_FIELDS = new Set(['ISPPassword', 'Password', 'CMSPass']);

/**
 * The record pages save through page script, not a form post: save() joins these fields with
 * "|" (a checkbox as true or false) and posts the text to FWDSave, UserSave or WPSave.
 */
export const PIPE_ORDER = {
  fwd: ['TO', 'AT', 'Times', 'FWD', 'HRB', 'HRP', 'BBSHA', 'EnF', 'Interval', 'EnR', 'RInterval', 'NoWait',
    'Blocked', 'FBBBlock', 'Personal', 'Bin', 'B1', 'B2', 'CTRLZ', 'ConTimeOut'],
  user: ['BBS', 'PermitEmail', 'PMS', 'RMSExUser', 'SYSOP', 'PollRMS', 'Expert', 'SSID1', 'SSID2', 'SSID3', 'SSID4',
    'Excluded', 'Hold', 'SYSOPLM', 'NOWINLINK', 'ALLOWBULLS', 'NTSMPS', 'RMSREDIR', 'APRSMFOR', 'APRSSSID',
    'LastListed', 'Name', 'Password', 'CMSPass', 'QTH', 'ZIP', 'HomeBBS'],
  wp: ['Name', 'Home1', 'Home2', 'QTH1', 'QTH2', 'ZIP1', 'ZIP2'],
} as const;

export type PipePage = keyof typeof PIPE_ORDER;

/**
 * Text the node's save handler matches anywhere in the body before it reads the fields, so
 * a field holding it would turn a save into another command (BBSHTMLConfig.c).
 */
export const PIPE_TRIGGERS: Record<PipePage, string[]> = {
  fwd: ['StartForward', 'CopyForward'],
  user: ['Cancel', 'Delete', 'Add='],
  wp: ['Cancel=Cancel'],
};
