import { describe, expect, it } from 'vitest';

import { rdPhoneMessageSchema } from '@/contracts/host-v3';
import { createSender, parseMacMessage, truncateRunes, type Outgoing } from './protocol';

function rig(display?: string) {
  const out: Outgoing[] = [];
  return { out, send: createSender((o) => out.push(o), () => display) };
}

describe('sender', () => {
  it('stamps a monotonic seq across moves, buttons and scrolls, and routes by reliability', () => {
    const { out, send } = rig();
    send.pointerMove({ x: 0.1, y: 0.2 });
    send.pointerButton({ x: 0.1, y: 0.2 }, 'left', true);
    send.pointerScroll(0, 12);
    expect(out.map((o) => o.channel)).toEqual(['pointer', 'control', 'pointer']);
    expect(out.map((o) => (o.message as { seq: number }).seq)).toEqual([1, 2, 3]);
  });

  it('clamps coordinates and carries the display id when set', () => {
    const { out, send } = rig('7');
    send.pointerMove({ x: 1.4, y: -3 });
    expect(out[0]!.message).toMatchObject({ x: 1, y: 0, displayId: '7' });
  });

  it('every message it can build is one the Mac decodes', () => {
    const { out, send } = rig('1');
    send.pointerMove({ x: 0.5, y: 0.5 });
    send.pointerButton({ x: 0.5, y: 0.5 }, 'right', false, 2);
    send.pointerScroll(3.6, -4000.5);
    send.key('KeyA', true);
    send.tapKey('Enter');
    send.textInsert('你好 🙂');
    send.clipboardSet('x');
    send.clipboardGet();
    send.displaySelect('2');
    send.qualitySet('high');
    send.keyframeRequest();
    send.ping(1);
    send.releaseAll();
    send.statsRequest();
    send.sessionEnd();
    for (const o of out) expect(rdPhoneMessageSchema.safeParse(o.message).success).toBe(true);
  });

  it('drops an all-zero scroll and caps a huge one', () => {
    const { out, send } = rig();
    send.pointerScroll(0.2, 0.3);
    send.pointerScroll(0, 99999);
    expect(out).toHaveLength(1);
    expect(out[0]!.message).toMatchObject({ dy: 4000 });
  });

  it('cuts text on a code point, never inside a surrogate pair', () => {
    expect(truncateRunes('a🙂b', 2)).toBe('a🙂');
    const { out, send } = rig();
    send.textInsert('🙂'.repeat(5000));
    expect(Array.from((out[0]!.message as { text: string }).text)).toHaveLength(4096);
    send.textInsert('');
    expect(out).toHaveLength(1);
  });

  it('shrinks an oversized clipboard under the Mac’s byte cap', () => {
    const { out, send } = rig();
    send.clipboardSet('é'.repeat(200_000)); // 400 KB
    const text = (out[0]!.message as { text: string }).text;
    expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(256 * 1024);
    expect(text.length).toBeGreaterThan(100_000);
  });
});

describe('parseMacMessage', () => {
  it('decodes known frames and ignores the rest', () => {
    expect(parseMacMessage('{"type":"pong","t":5}')).toEqual({ type: 'pong', t: 5 });
    expect(parseMacMessage('{"type":"nope"}')).toBeNull();
    expect(parseMacMessage('not json')).toBeNull();
    expect(parseMacMessage(new ArrayBuffer(2))).toBeNull();
  });
});
