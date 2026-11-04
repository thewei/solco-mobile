import { describe, expect, it } from 'vitest';

import { CLIP_START, macRead, phoneRead } from './clipboard-sync';

describe('clipboard sync decisions', () => {
  it('only seeds on the first reading of each side', () => {
    const a = phoneRead(CLIP_START, 'old');
    expect(a.send).toBeNull();
    const b = macRead(a.state, 'older');
    expect(b.write).toBeNull();
    expect(b.state).toEqual({ phone: 'old', mac: 'older' });
  });
  it('sends a new phone copy once and never echoes our own write back', () => {
    let s = macRead(phoneRead(CLIP_START, 'x').state, 'y').state;
    const sent = phoneRead(s, 'hello');
    expect(sent.send).toBe('hello');
    s = sent.state;
    expect(phoneRead(s, 'hello').send).toBeNull();
    expect(macRead(s, 'hello').write).toBeNull();
  });
  it('writes a new Mac copy to the phone and ignores empty text', () => {
    let s = macRead(phoneRead(CLIP_START, 'x').state, 'y').state;
    const got = macRead(s, 'from mac');
    expect(got.write).toBe('from mac');
    s = got.state;
    expect(phoneRead(s, 'from mac').send).toBeNull();
    expect(macRead(s, '').write).toBeNull();
    expect(phoneRead(s, '').send).toBeNull();
  });
});
