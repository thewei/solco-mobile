import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { V3_LIMITS, terminalClientMessageSchema } from '@/contracts/host-v3';
import {
  ENCODED_PING,
  clampGrid,
  createFrameAssembler,
  decodeServerText,
  encodeInput,
  encodeResize,
  isValidGrid,
  terminalStreamPath,
  utf8ByteLength,
} from '@/lib/terminal-protocol-v3';

const fixture = (name: string) =>
  readFileSync(join(import.meta.dirname, '..', 'contracts', '__fixtures__', 'v3', name), 'utf8');
const bytes = (s: string) => new TextEncoder().encode(s);

describe('terminalStreamPath', () => {
  it('builds the Host path, encoding opaque ids and the instance', () => {
    expect(terminalStreamPath('term_a', { cols: 51, rows: 19 })).toBe('/api/v3/terminals/term_a/stream?cols=51&rows=19');
    expect(terminalStreamPath('a/b c', { cols: 51, rows: 19 }, 'my session')).toBe(
      '/api/v3/terminals/a%2Fb%20c/stream?cols=51&rows=19&instance=my%20session',
    );
  });

  it('refuses a grid or id the Host would refuse', () => {
    expect(() => terminalStreamPath('t', { cols: 9, rows: 19 })).toThrow();
    expect(() => terminalStreamPath('t', { cols: 51, rows: 201 })).toThrow();
    expect(() => terminalStreamPath('t', { cols: 51.5, rows: 19 })).toThrow();
    expect(() => terminalStreamPath('', { cols: 51, rows: 19 })).toThrow();
  });

  it('clamps a measured viewport into range', () => {
    expect(clampGrid({ cols: 3, rows: 1 })).toEqual({ cols: V3_LIMITS.minCols, rows: V3_LIMITS.minRows });
    expect(clampGrid({ cols: 9999, rows: 9999 })).toEqual({ cols: V3_LIMITS.maxCols, rows: V3_LIMITS.maxRows });
    expect(clampGrid({ cols: 50.6, rows: 19.2 })).toEqual({ cols: 51, rows: 19 });
    expect(isValidGrid(clampGrid({ cols: NaN, rows: NaN }))).toBe(false); // NaN stays the caller's bug
  });
});

describe('client messages', () => {
  it('encodes exactly the golden shapes', () => {
    expect(JSON.parse(encodeInput({ text: 'ls', keys: ['enter'] })!)).toEqual(JSON.parse(fixture('terminal-client-input.json')));
    expect(JSON.parse(encodeResize({ cols: 60, rows: 22 })!)).toEqual(JSON.parse(fixture('terminal-client-resize.json')));
    expect(JSON.parse(ENCODED_PING)).toEqual(JSON.parse(fixture('terminal-client-ping.json')));
  });

  it('everything it encodes passes the Host contract', () => {
    for (const raw of [encodeInput({ text: '你好' }), encodeInput({ keys: ['ctrl+c', 'up'] }), encodeResize({ cols: 10, rows: 3 })]) {
      expect(terminalClientMessageSchema.safeParse(JSON.parse(raw!)).success).toBe(true);
    }
  });

  it('refuses input the Host would reject, before it leaves the phone', () => {
    expect(encodeInput({})).toBeNull();
    expect(encodeInput({ text: '', keys: [] })).toBeNull();
    expect(encodeInput({ keys: ['enter; rm -rf'] })).toBeNull();
    expect(encodeInput({ keys: ['a'.repeat(33)] })).toBeNull();
    expect(encodeInput({ keys: Array(V3_LIMITS.maxInputKeys + 1).fill('up') })).toBeNull();
    expect(encodeInput({ text: 'a'.repeat(V3_LIMITS.maxInputTextBytes + 1) })).toBeNull();
    expect(encodeInput({ text: 'a'.repeat(V3_LIMITS.maxInputTextBytes) })).not.toBeNull();
    expect(encodeResize({ cols: 9, rows: 3 })).toBeNull();
  });

  it('counts the limit in UTF-8 bytes, as the Host does', () => {
    expect(utf8ByteLength('a')).toBe(1);
    expect(utf8ByteLength('é')).toBe(2);
    expect(utf8ByteLength('你')).toBe(3);
    expect(utf8ByteLength('😀')).toBe(4);
    expect(encodeInput({ text: '你'.repeat(Math.floor(V3_LIMITS.maxInputTextBytes / 3) + 1) })).toBeNull();
    expect(encodeInput({ text: '你'.repeat(Math.floor(V3_LIMITS.maxInputTextBytes / 3)) })).not.toBeNull();
  });

  it('omits empty fields so the wire stays minimal', () => {
    expect(JSON.parse(encodeInput({ text: 'x', keys: [] })!)).toEqual({ t: 'input', text: 'x' });
    expect(JSON.parse(encodeInput({ keys: ['enter'] })!)).toEqual({ t: 'input', keys: ['enter'] });
  });
});

describe('server text frames', () => {
  it('decodes the golden frames and ignores anything else', () => {
    expect(decodeServerText(fixture('terminal-frame-header.json'))).toEqual({ t: 'frame', seq: 1, full: true, w: 51, h: 19 });
    expect(decodeServerText(fixture('terminal-pong.json'))).toEqual({ t: 'pong' });
    expect(decodeServerText(fixture('terminal-input-error-refused.json'))).toEqual({ t: 'input.error', code: 'refused', message: 'agent is busy' });
    expect(decodeServerText('not json')).toBeNull();
    expect(decodeServerText('{"t":"unknown"}')).toBeNull();
    expect(decodeServerText('{"t":"frame","seq":-1,"full":true,"w":1,"h":1}')).toBeNull();
    expect(decodeServerText('{"t":"input.error","code":"new_code"}')).toBeNull();
  });
});

describe('frame assembler', () => {
  it('pairs a header with the binary frame that follows it', () => {
    const a = createFrameAssembler();
    expect(a.text(fixture('terminal-frame-header.json'))).toBeNull();
    const event = a.binary(bytes('\x1b[2JHELLO'));
    expect(event).toEqual({
      kind: 'frame',
      frame: { seq: 1, full: true, width: 51, height: 19, bytes: bytes('\x1b[2JHELLO') },
    });
  });

  it('keeps frames in order and treats a delta as a delta', () => {
    const a = createFrameAssembler();
    const header = (seq: number, full: boolean) => JSON.stringify({ t: 'frame', seq, full, w: 51, h: 19 });
    a.text(header(1, true));
    const first = a.binary(bytes('FULL'));
    a.text(header(2, false));
    const second = a.binary(bytes('delta'));
    expect(first?.kind === 'frame' && first.frame.seq).toBe(1);
    expect(second?.kind === 'frame' && [second.frame.seq, second.frame.full]).toEqual([2, false]);
  });

  it('drops a body with no header, and a body is never delivered twice', () => {
    const a = createFrameAssembler();
    expect(a.binary(bytes('orphan'))).toBeNull();
    a.text(fixture('terminal-frame-header.json'));
    expect(a.binary(bytes('x'))).not.toBeNull();
    expect(a.binary(bytes('x again'))).toBeNull();
  });

  it('a newer header replaces one whose body was lost; reset forgets it', () => {
    const a = createFrameAssembler();
    a.text(JSON.stringify({ t: 'frame', seq: 5, full: false, w: 51, h: 19 }));
    a.text(JSON.stringify({ t: 'frame', seq: 6, full: true, w: 51, h: 19 }));
    const event = a.binary(bytes('y'));
    expect(event?.kind === 'frame' && event.frame.seq).toBe(6);
    a.text(JSON.stringify({ t: 'frame', seq: 7, full: true, w: 51, h: 19 }));
    a.reset();
    expect(a.binary(bytes('z'))).toBeNull();
  });

  it('surfaces pong and input errors as events', () => {
    const a = createFrameAssembler();
    expect(a.text(fixture('terminal-pong.json'))).toEqual({ kind: 'pong' });
    expect(a.text(fixture('terminal-input-error-bad.json'))).toEqual({ kind: 'input-error', code: 'bad_input', message: undefined });
  });
});
