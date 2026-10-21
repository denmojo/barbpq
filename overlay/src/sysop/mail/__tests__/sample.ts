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
