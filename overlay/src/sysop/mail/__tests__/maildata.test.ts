import { fixture } from '../../../data/__tests__/helpers';
import { fetchForwarding } from '../../model';
import { saveRecord } from '../maildata';
import { fwdPage, KEY } from './sample';

afterEach(() => vi.unstubAllGlobals());

test('exclusive(): the shell poll FwdDetails(RMS) waits for a pick-and-save of another partner', async () => {
  const order: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const body = init?.body ? Array.from(init.body as Uint8Array, (b) => String.fromCharCode(b)).join('') : '';
    const path = url.split('?')[0];
    if (path === '/Mail/FwdDetails' || path === '/Mail/FWDSave') order.push(`${path.slice(6)}(${body.split('|')[0]})`);
    let text = '';
    if (url === '/Mail/Header') text = fixture('mail-header.html');
    else if (url === `/Mail/FwdList.txt?${KEY}`) text = fixture('mail-fwdlist.txt');
    else if (url === `/Mail/FwdDetails?${KEY}`) {
      if (body === 'AD6DM') await gate;
      text = fwdPage(body);
    } else if (url === `/Mail/FWDSave?${KEY}`) text = fwdPage('AD6DM');
    else return new Response('nope', { status: 404 });
    return new Response(text, { status: 200 });
  });
  const save = saveRecord('fwd', 'AD6DM', () => 'x|');
  await vi.waitFor(() => expect(order).toEqual(['FwdDetails(AD6DM)']));
  const poll = fetchForwarding();
  await new Promise((r) => setTimeout(r, 20));
  expect(order).toEqual(['FwdDetails(AD6DM)']);
  release();
  await Promise.all([save, poll]);
  expect(order).toEqual(['FwdDetails(AD6DM)', 'FWDSave(x)', 'FwdDetails(RMS)']);
});
