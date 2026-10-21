// Each keystroke in the editor should run the config scan and the line diff once, not once per consumer.
import { render, screen, fireEvent } from '@testing-library/preact';
import * as check from '../cfgcheck';
import * as diff from '../cfgdiff';
import { NodeSettings } from '../NodeSettings';
import { cfgDraft, cfgLoaded, resetSettings } from '../draft';
import { SAMPLE_CFG } from './sample';

vi.mock('../cfgcheck', async () => {
  const a = await vi.importActual<typeof import('../cfgcheck')>('../cfgcheck');
  return { ...a, scanCfg: vi.fn(a.scanCfg), checkCfg: vi.fn(a.checkCfg), analyzeCfg: vi.fn(a.analyzeCfg) };
});
vi.mock('../cfgdiff', async () => {
  const a = await vi.importActual<typeof import('../cfgdiff')>('../cfgdiff');
  return { ...a, lineDiff: vi.fn(a.lineDiff) };
});

beforeEach(() => {
  resetSettings();
  cfgLoaded.value = SAMPLE_CFG;
  cfgDraft.value = SAMPLE_CFG;
});

test('one keystroke: one config scan and one line diff', () => {
  render(<NodeSettings />);
  const ta = screen.getByRole('textbox', { name: 'bpq32.cfg' });
  const scans = () => vi.mocked(check.scanCfg).mock.calls.length + vi.mocked(check.checkCfg).mock.calls.length
    + vi.mocked(check.analyzeCfg).mock.calls.length;
  const diffs = () => vi.mocked(diff.lineDiff).mock.calls.length;
  const s0 = scans();
  const d0 = diffs();
  fireEvent.input(ta, { target: { value: `${SAMPLE_CFG}; x\n` } });
  expect(scans() - s0).toBe(1);
  expect(diffs() - d0).toBe(1);
});
