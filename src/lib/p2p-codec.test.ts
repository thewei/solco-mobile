import { describe, expect, it } from 'vitest';

import { base64Decode, base64Encode, createReassembler, fragmentFrame, P2P_FRAGMENT, utf8Decode, utf8Encode } from '@/lib/p2p-codec';

describe('utf8', () => {
  it('round-trips ASCII, CJK and astral characters like TextEncoder', () => {
    for (const text of ['', 'hello', '中文 chat', 'emoji 🙂 ok', 'a\u0000b', '€ ¢ ñ']) {
      const bytes = utf8Encode(text);
      expect(Array.from(bytes)).toEqual(Array.from(new TextEncoder().encode(text)));
      expect(utf8Decode(bytes)).toBe(text);
    }
  });
  it('replaces a truncated sequence instead of throwing', () => {
    expect(utf8Decode(Uint8Array.from([0x61, 0xe4, 0xb8]))).toBe('a\ufffd');
  });
});

describe('base64', () => {
  it('matches the standard alphabet and padding for every tail length', () => {
    for (const text of ['', 'f', 'fo', 'foo', 'foob', 'fooba', 'foobar']) {
      const bytes = new TextEncoder().encode(text);
      const encoded = base64Encode(bytes);
      expect(encoded).toBe(btoa(text));
      expect(utf8Decode(base64Decode(encoded))).toBe(text);
    }
  });
  it('round-trips arbitrary bytes and rejects garbage', () => {
    const bytes = Uint8Array.from({ length: 300 }, (_, i) => (i * 7) & 0xff);
    expect(Array.from(base64Decode(base64Encode(bytes)))).toEqual(Array.from(bytes));
    expect(() => base64Decode('@@@@')).toThrow();
  });
});

describe('fragment + reassemble', () => {
  it('a small frame is one message with header 0', () => {
    const messages = fragmentFrame('{"t":"hreq"}');
    expect(messages).toHaveLength(1);
    expect(messages[0]![0]).toBe(0);
  });
  it('a large frame splits at the Go Host fragment size: header 1 until the last 0', () => {
    const json = JSON.stringify({ t: 'hchunk', b: 'x'.repeat(P2P_FRAGMENT * 2 + 5) });
    const messages = fragmentFrame(json);
    expect(messages.length).toBeGreaterThanOrEqual(3);
    expect(messages.slice(0, -1).every((m) => m[0] === 1 && m.length === 1 + P2P_FRAGMENT)).toBe(true);
    expect(messages.at(-1)![0]).toBe(0);
    const got: string[] = [];
    const reassembler = createReassembler((frame) => got.push(frame));
    for (const m of messages) reassembler.push(m);
    expect(got).toEqual([json]);
  });
  it('keeps multi-byte characters intact across a fragment boundary', () => {
    const json = '中'.repeat(P2P_FRAGMENT);
    const got: string[] = [];
    const reassembler = createReassembler((frame) => got.push(frame));
    for (const m of fragmentFrame(json)) reassembler.push(m);
    expect(got[0]).toBe(json);
  });
  it('refuses a frame beyond the cap and recovers for the next one', () => {
    const got: string[] = [];
    const reassembler = createReassembler((frame) => got.push(frame), 10);
    expect(() => reassembler.push(Uint8Array.from([1, ...new Array(20).fill(65)]))).toThrow('too large');
    reassembler.push(Uint8Array.from([0, 104, 105]));
    expect(got).toEqual(['hi']);
  });
});
