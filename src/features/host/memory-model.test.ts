import { describe, expect, it } from 'vitest';

import type { Proactivity } from '@/contracts/host-v3';
import { draftOf, inputOf, isDirty, noteSync, quietLine } from '@/features/host/memory-model';

const rules: Proactivity = { assistantId: 'a_1', level: 'follow_up', quietStart: '', quietEnd: '', tz: '', reportEveryMin: 0, dailyBudget: 20, dispatchToday: 3, quietNow: false, revision: 0, updatedAt: 0 };

describe('note editor sync', () => {
  const base = { text: 'a', rev: 'r1' };
  it('is clean and quiet while the Mac has not moved', () => {
    expect(noteSync({ base, text: 'a' }, base)).toEqual({ dirty: false, adopt: false, conflict: false });
    expect(noteSync({ base, text: 'typed' }, base)).toEqual({ dirty: true, adopt: false, conflict: false });
  });
  it('adopts a newer note when there is nothing typed to lose', () => {
    expect(noteSync({ base, text: 'a' }, { text: 'b', rev: 'r2' })).toEqual({ dirty: false, adopt: true, conflict: false });
  });
  it('adopts when what was typed already is the new text (a save that just went through)', () => {
    expect(noteSync({ base, text: 'b' }, { text: 'b', rev: 'r2' })).toEqual({ dirty: true, adopt: true, conflict: false });
  });
  it('flags a conflict instead of merging when both sides changed', () => {
    expect(noteSync({ base, text: 'mine' }, { text: 'theirs', rev: 'r2' })).toEqual({ dirty: true, adopt: false, conflict: true });
  });
});

describe('proactivity form', () => {
  it('starts from the Mac and is clean until changed', () => {
    const r = inputOf(draftOf(rules), rules, 'Asia/Shanghai');
    expect(r.ok && r.input).toEqual({ level: 'follow_up', quietStart: '', quietEnd: '', tz: '', reportEveryMin: 0, dailyBudget: 20 });
    expect(r.ok && isDirty(r.input, rules)).toBe(false);
  });
  it('sends the phone time zone only when quiet hours are on, and keeps the Mac zone once set', () => {
    const on = { ...draftOf(rules), quiet: true };
    const first = inputOf(on, rules, 'Asia/Shanghai');
    expect(first.ok && first.input).toMatchObject({ quietStart: '22:00', quietEnd: '08:00', tz: 'Asia/Shanghai' });
    const kept = inputOf(on, { ...rules, tz: 'Europe/Paris' }, 'Asia/Shanghai');
    expect(kept.ok && kept.input.tz).toBe('Europe/Paris');
    const off = inputOf({ ...on, quiet: false }, { ...rules, tz: 'Europe/Paris', quietStart: '22:00', quietEnd: '08:00' }, 'x');
    expect(off.ok && off.input).toMatchObject({ quietStart: '', quietEnd: '', tz: '' });
  });
  it('refuses a form the core would refuse, with the one thing wrong', () => {
    const base = draftOf(rules);
    expect(inputOf({ ...base, quiet: true, start: '25:00' }, rules, 'z')).toEqual({ ok: false, error: 'Quiet hours are times like 22:00 and 08:00.' });
    expect(inputOf({ ...base, every: '-1' }, rules, 'z').ok).toBe(false);
    expect(inputOf({ ...base, every: '1.5' }, rules, 'z').ok).toBe(false);
    expect(inputOf({ ...base, budget: '0' }, rules, 'z').ok).toBe(false);
    expect(inputOf({ ...base, budget: '101' }, rules, 'z').ok).toBe(false);
    expect(inputOf({ ...base, budget: '' }, rules, 'z').ok).toBe(false);
  });
  it('states the quiet window', () => {
    expect(quietLine(rules)).toBe('No quiet hours');
    expect(quietLine({ ...rules, quietStart: '22:00', quietEnd: '08:00', tz: 'Asia/Shanghai', quietNow: true })).toBe('Quiet 22:00–08:00 (Asia/Shanghai) · quiet now');
  });
});
