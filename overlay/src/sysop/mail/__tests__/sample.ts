// Mail fixtures for the mail screens. Secrets are planted here, never in the captured files.
import { fixture } from '../../../data/__tests__/helpers';
import { parseMailKey } from '../../../data/pages';

export const KEY = parseMailKey(fixture('mail-header.html')) as string;

/** Values planted in password fields; none may reach the DOM, storage or the console. */
export const ISP_PASSWORD = 'ispSecret7q';
export const USER_PASSWORD = 'bbsPass4z';
export const CMS_HIDDEN = '***********';

export const confPage = (): string =>
  fixture('mail-conf.html').replace('<input value="" name="ISPPassword">', `<input value="${ISP_PASSWORD}" name="ISPPassword">`);

/** The node's UserDetails reply for a call, with a BBS password and the starred CMS pass it sends. */
export function userPage(call: string, withPasswords = true): string {
  let html = fixture('mail-userdetails-rms.html').replace('Update User RMS', `Update User ${call}`);
  if (withPasswords) {
    html = html
      .replace('name="Password" value=""', `name="Password" value="${USER_PASSWORD}"`)
      .replace('name="CMSPass" value=""', `name="CMSPass" value="${CMS_HIDDEN}"`);
  }
  return html;
}

/** FwdDetails reply for a call: the RMS record with its heading changed. */
export const fwdPage = (call: string): string =>
  fixture('mail-fwddetails-rms.html').replace('Forwarding Config for RMS', `Forwarding Config for ${call}`);

export const SECRETS = [ISP_PASSWORD, USER_PASSWORD, CMS_HIDDEN];

/** Staging's four messages, newest first: number, status, title. */
export const MESSAGES: [number, string, string][] = [
  [4, 'N', 'Housekeeping Results'],
  [3, 'N', 'Message 2 Held - User has Hold Messages flag set'],
  [2, 'H', 'uiapi test'],
  [1, 'N', 'New User N0CALL'],
];

/** The node's MsgDetails reply for one message: the captured message 2 with its number, status and title changed. */
export function msgPage(n: number, status: string, title: string): string {
  return fixture('mail-msgdetails-2.html')
    .replace('<h4>Message 2</h4>', `<h4>Message ${n}</h4>`)
    .replace('<option selected value=H>H</option>', '<option  value=H>H</option>')
    .replace(`<option  value=${status}>${status}</option>`, `<option selected value=${status}>${status}</option>`)
    .replace('value="uiapi test"', `value="${title}"`)
    .replace('value="2_AD6DM"', `value="${n}_AD6DM"`);
}

export const msgByBody = (body: string): string => {
  const m = MESSAGES.find(([n]) => String(n) === body);
  return m ? msgPage(...m) : '';
};
