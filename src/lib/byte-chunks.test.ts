import { describe, expect, it } from 'vitest';

import { base64Encode } from './p2p-codec';
import { concatBytes } from './byte-chunks';

describe('concatBytes', () => {
  it('returns the single chunk untouched', () => {
    const only = new Uint8Array([1, 2, 3]);
    expect(concatBytes([only])).toBe(only);
  });

  it('joins chunks in order', () => {
    expect(Array.from(concatBytes([new Uint8Array([1]), new Uint8Array([]), new Uint8Array([2, 3])]))).toEqual([1, 2, 3]);
  });

  it('encodes once over the merged bytes (per-chunk padding would corrupt a joined string)', () => {
    const a = new Uint8Array([0x41]);
    const b = new Uint8Array([0x42, 0x43]);
    expect(base64Encode(concatBytes([a, b]))).toBe(btoa('ABC'));
    expect(base64Encode(a) + base64Encode(b)).not.toBe(btoa('ABC'));
  });
});
