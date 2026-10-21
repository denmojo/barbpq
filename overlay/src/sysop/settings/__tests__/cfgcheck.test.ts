import { checkCfg, scanCfg } from '../cfgcheck';
import { SAMPLE_CFG } from './sample';

const errors = (text: string) => checkCfg(text).filter((i) => i.severity === 'error');
const warnings = (text: string) => checkCfg(text).filter((i) => i.severity === 'warning');

test('the sample config checks clean', () => {
  expect(checkCfg(SAMPLE_CFG)).toEqual([]);
});

test('a PORT without ENDPORT is an error on the PORT line', () => {
  const text = 'NODECALL=N0CALL\nPORT\n PORTNUM=1\n ID=Radio\n';
  expect(errors(text)).toEqual([{ line: 2, severity: 'error', message: 'PORT block has no ENDPORT' }]);
});

test('a PORT that starts before the last one ended is an error', () => {
  const text = 'NODECALL=N0CALL\nPORT\n PORTNUM=1\nPORT\n PORTNUM=2\nENDPORT\n';
  expect(errors(text)).toEqual([
    { line: 4, severity: 'error', message: 'PORT before the ENDPORT of the PORT block on line 2' },
  ]);
});

test('an ENDPORT outside any PORT block is an error', () => {
  expect(errors('NODECALL=N0CALL\nENDPORT\n')).toEqual([
    { line: 2, severity: 'error', message: 'ENDPORT without a PORT' },
  ]);
});

test('an unknown keyword is a warning, in the main section and in a port, but not in driver CONFIG text', () => {
  const text = 'NODECALL=N0CALL\nFROBNICATE=1\nPORT\n TXTAILX=5\n CONFIG\n WHATEVER 1 2\nENDPORT\n';
  expect(warnings(text)).toEqual([
    { line: 2, severity: 'warning', message: 'Unknown keyword "FROBNICATE"; the node ignores this line' },
    { line: 4, severity: 'warning', message: 'Unknown keyword "TXTAILX"; the node ignores this line' },
  ]);
  expect(errors(text)).toEqual([]);
});

test('keywords match without regard to case', () => {
  expect(checkCfg('nodecall=N0CALL\nport\n txtail=5\nendport\n')).toEqual([]);
});

test('a character above U+00FF is an error naming the line; Latin-1 such as ° is fine', () => {
  const text = 'NODECALL=N0CALL\nMAPCOMMENT=Grid 38° N\nINFOMSG:\nPrice 5 €\n***\n';
  expect(errors(text)).toEqual([
    { line: 4, severity: 'error', message: 'Character "€" cannot be sent to the node (not ISO-8859-1)' },
  ]);
});

test('an emoji (outside the BMP) is reported once', () => {
  expect(errors('NODECALL=N0CALL ; \u{1F4E1}\n')).toEqual([
    { line: 1, severity: 'error', message: 'Character "\u{1F4E1}" cannot be sent to the node (not ISO-8859-1)' },
  ]);
});

test('a text block without its closing *** is an error on the block line', () => {
  expect(errors('NODECALL=N0CALL\nINFOMSG:\nHello\n')).toEqual([
    { line: 2, severity: 'error', message: 'INFOMSG: block has no closing ***' },
  ]);
});

test('a missing NODECALL is an error', () => {
  expect(errors('SIMPLE\n')).toEqual([{ line: 1, severity: 'error', message: 'No NODECALL line; the node will not start' }]);
});

test('a block comment that never ends is a warning', () => {
  expect(warnings('NODECALL=N0CALL\n/* off\nPORT\n')).toEqual([
    { line: 2, severity: 'warning', message: 'Comment block has no closing */; the rest of the file is ignored' },
  ]);
});

test('scanCfg classifies lines for the highlighter', () => {
  const lines = scanCfg(SAMPLE_CFG);
  const kind = (text: string) => lines.find((l) => l.text === text)?.kind;
  expect(kind('; Basic RMS configuration')).toBe('comment');
  expect(kind('NODECALL=AD6DM-11 ; node call')).toBe('keyword');
  expect(kind('AD6DM-10 linbpq VARA FM ; kept as text')).toBe('text');
  expect(kind('***')).toBe('textend');
  expect(kind('PORT')).toBe('comment'); // the first PORT is inside /* */
  expect(lines.filter((l) => l.kind === 'port')).toHaveLength(3);
  expect(kind(' CMSCALL=AD6DM')).toBe('driver');
  expect(kind('ENDPORT')).toBe('endport');
});
