import { describe, expect, it } from 'vitest';

import type { AssistantMemory, MemoryReview, Proactivity } from '@/contracts/host-v3';
import { draftOf, inputOf, isDirty, memoryAuthor, memoryNote, quietLine, splitMemory } from '@/features/host/memory-model';

const item = (id: string, state: string, kind = 'fact'): AssistantMemory => ({
  id, assistantId: 'a_1', scope: 'assistant', kind, content: id, sourceRef: 'user', state, sharedWith: [], revision: 1, createdAt: 1, updatedAt: 1,
});
const review: MemoryReview = {
  assistantId: 'a_1', approved: 2, candidates: 2, max: 500,
  duplicates: [['m_a', 'm_b']], staleCandidates: ['m_c'], conflicts: ['m_d'],
  items: [item('m_a', 'approved'), item('m_b', 'approved'), item('m_c', 'candidate'), item('m_d', 'candidate', 'conflict')],
};
const rules: Proactivity = { assistantId: 'a_1', level: 'follow_up', quietStart: '', quietEnd: '', tz: '', reportEveryMin: 0, dailyBudget: 20, dispatchToday: 3, quietNow: false, revision: 0, updatedAt: 0 };

describe('memory wording', () => {
  it('labels authors and never invents one', () => {
    expect(memoryAuthor('files')).toBe('Folder edit');
    expect(memoryAuthor('robot')).toBe('robot');
  });
  it('words only what the core flagged', () => {
    const [a, c, d] = [0, 2, 3].map((i) => review.items[i] as AssistantMemory);
    expect(memoryNote(review, a as AssistantMemory)).toBe('Looks like a duplicate');
    expect(memoryNote(review, c as AssistantMemory)).toBe('Waiting a while');
    expect(memoryNote(review, d as AssistantMemory)).toBe('Edit conflict');
    expect(memoryNote({ ...review, duplicates: [], staleCandidates: [] }, a as AssistantMemory)).toBe('');
  });
  it('splits candidates from approved items', () => {
    const { candidates, approved } = splitMemory(review);
    expect(candidates.map((m) => m.id)).toEqual(['m_c', 'm_d']);
    expect(approved.map((m) => m.id)).toEqual(['m_a', 'm_b']);
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
