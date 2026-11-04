import { describe, expect, it } from 'vitest';

import type { SessionRow } from '@/contracts/host-v3';

import { HostV3Error } from '@/lib/host-client-v3';

import { continueFailureMessage, runningLabel, runningTone, sessionAgentName, sessionCaption, splitSessions, trashCaption, trashFailureMessage } from './sessions-model';

const row = (over: Partial<SessionRow> = {}): SessionRow => ({ id: 's1', agent: 'claude-code', title: 'Fix it', ...over });

describe('sessions model', () => {
  it('words the running state with the desktop pill vocabulary', () => {
    expect(runningLabel('working')).toBe('Running');
    expect(runningLabel('attention')).toBe('Needs you');
    expect(runningLabel('review')).toBe('Ready');
    expect(runningLabel('idle')).toBe('Open');
    expect(runningLabel('something-new')).toBe('Open');
    expect(runningTone('attention')).toBe('attention');
    expect(runningTone('idle')).toBe('muted');
  });

  it('names agents and keeps an unknown id as is', () => {
    expect(sessionAgentName('codex')).toBe('Codex');
    expect(sessionAgentName('future-agent')).toBe('future-agent');
  });

  it('captions agent · project · age and drops what is missing', () => {
    const now = 10 * 60 * 60 * 1000;
    expect(sessionCaption(row({ project: 'solco', updatedMs: now - 3 * 60 * 60 * 1000 }), now)).toBe('Claude Code · solco · 3h');
    expect(sessionCaption(row(), now)).toBe('Claude Code');
  });

  it('splits running sessions from the rest, order kept', () => {
    const running = { instance: 'default', paneId: 'p1', state: 'working' };
    const { running: a, rest } = splitSessions([row({ id: 'a', running }), row({ id: 'b' }), row({ id: 'c', running })]);
    expect(a.map((r) => r.id)).toEqual(['a', 'c']);
    expect(rest.map((r) => r.id)).toEqual(['b']);
  });

  it('words every Continue refusal and never leaks a raw code', () => {
    const fail = (code: string, kind: 'http' | 'transport' = 'http') => continueFailureMessage(new HostV3Error(kind, 'raw', { code }));
    expect(fail('needs_project')).toMatch(/project folder/);
    expect(fail('launch_uncertain')).toMatch(/may have started/);
    expect(fail('launch_conflict')).toMatch(/already being continued/);
    expect(fail('unknown_session')).toMatch(/no longer listed/);
    expect(fail('x', 'transport')).toMatch(/Could not reach/);
    expect(continueFailureMessage(new Error('boom'))).toBe('Something went wrong. Try again.');
  });
});

describe('sessions trash words', () => {
  const entry = { id: '1785549600000-0a1b2c3d', agent: 'codex', title: 'Refactor', project: 'solco' };

  it('captions agent · project · how long ago it was deleted', () => {
    const now = 10 * 60 * 60 * 1000;
    expect(trashCaption({ ...entry, deletedMs: now - 2 * 60 * 60 * 1000 }, now)).toBe('Codex · solco · deleted 2h ago');
    expect(trashCaption({ id: entry.id, agent: 'codex', title: 'x' }, now)).toBe('Codex');
  });

  it('words each refusal the Mac names and falls back to its own message', () => {
    expect(trashFailureMessage(new HostV3Error('http', 'x', { status: 409, code: 'session_in_use' }))).toMatch(/still using/);
    expect(trashFailureMessage(new HostV3Error('http', 'x', { status: 409, code: 'session_exists' }))).toMatch(/already exists/);
    expect(trashFailureMessage(new HostV3Error('http', 'Mac said so', { status: 400, code: 'something_new' }))).toBe('Mac said so');
    expect(trashFailureMessage(new Error('x'))).toBe('Something went wrong. Try again.');
  });
});
