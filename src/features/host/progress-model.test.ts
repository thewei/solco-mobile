import { describe, expect, it } from 'vitest';

import { factLabel, factTone, milestoneLabel, milestoneTone, planLine, routineLabel, routineLine, routineTone } from './progress-model';

describe('progress-model', () => {
  it('words and tones for facts and milestones; unknown kinds stay readable', () => {
    expect(factLabel({ kind: 'ready' })).toBe('Needs you');
    expect(factLabel({ kind: 'task_added' })).toBe('Task filed');
    expect(factLabel({ kind: 'run_finished' })).toBe('Run settled');
    expect(factLabel({ kind: 'pulse' })).toBe('Progress');
    expect(factTone({ kind: 'blocked' })).toBe('bad');
    expect(factTone({ kind: 'verified' })).toBe('ok');
    expect(factLabel({ kind: 'newkind' })).toBe('newkind');
    expect(factTone({ kind: 'newkind' })).toBe('muted');
    expect(milestoneLabel({ state: 'needs_you' })).toBe('Needs you');
    expect(milestoneTone({ state: 'verified' })).toBe('ok');
    expect(milestoneTone({ state: 'pending' })).toBe('muted');
  });

  it('planLine counts what is proven, never a percentage', () => {
    expect(planLine({ total: 3, verified: 1, state: 'working', replans: 0 })).toBe('1 of 3 milestones verified · working');
    expect(planLine({ total: 1, verified: 0, state: 'waiting_user', replans: 2 })).toBe('0 of 1 milestone verified · waiting user · revised 2×');
    expect(planLine({ total: 0, verified: 0, state: 'draft', replans: 0 })).toBe('No milestones · draft');
  });

  it('routines: a draft waits for the person, a pause reads as paused, the line names what runs', () => {
    expect(routineLabel({ state: 'draft', paused: false })).toBe('Waiting for you');
    expect(routineTone({ state: 'active', paused: false })).toBe('ok');
    expect(routineLabel({ state: 'active', paused: true })).toBe('Paused');
    expect(routineTone({ state: 'stale', paused: false })).toBe('warn');
    expect(factTone({ kind: 'routine_failed' })).toBe('bad');
    expect(routineLine({ cron: '0 9 * * *', agent: 'claude', headless: true })).toBe('0 9 * * * · claude · headless');
    expect(routineLine({ cron: '0 9 * * *', agent: 'codex', headless: false })).toBe('0 9 * * * · codex');
  });
});
