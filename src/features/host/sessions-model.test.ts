import { describe, expect, it } from 'vitest';

import type { SessionRow } from '@/contracts/host-v3';

import { HostV3Error } from '@/lib/host-client-v3';

import { continueFailureMessage, runningStatus, sessionAgentName, sessionAgents, sessionCaption, sessionShelves, trashCaption, trashFailureMessage } from './sessions-model';

const row = (over: Partial<SessionRow> = {}): SessionRow => ({ id: 's1', agent: 'claude-code', title: 'Fix it', ...over });

describe('sessions model', () => {
  it('maps the running state onto the desktop pill vocabulary', () => {
    expect(runningStatus('working')).toBe('running');
    expect(runningStatus('attention')).toBe('needs');
    expect(runningStatus('review')).toBe('ready');
    expect(runningStatus('idle')).toBe('open');
    expect(runningStatus('something-new')).toBe('open');
  });

  it('names agents and keeps an unknown id as is', () => {
    expect(sessionAgentName('codex')).toBe('Codex');
    expect(sessionAgentName('future-agent')).toBe('future-agent');
  });

  it('captions agent · project and drops what is missing', () => {
    expect(sessionCaption(row({ project: 'solco' }))).toBe('Claude Code · solco');
    expect(sessionCaption(row())).toBe('Claude Code');
  });

  it('shelves the list: Today, Yesterday, Earlier by local day; a running session is Today and leads', () => {
    const now = new Date(2026, 10, 7, 15, 0, 0).getTime();
    const at = (day: number, hour: number) => new Date(2026, 10, day, hour, 0, 0).getTime();
    const running = { instance: 'default', paneId: 'p1', state: 'working' };
    const shelves = sessionShelves(
      [
        row({ id: 'old', updatedMs: at(1, 9) }),
        row({ id: 'today', updatedMs: at(7, 9) }),
        row({ id: 'late-yesterday', updatedMs: at(6, 23) }),
        row({ id: 'run', updatedMs: at(2, 9), running }),
        row({ id: 'undated' }),
        row({ id: 'early-yesterday', updatedMs: at(6, 0) }),
      ],
      now,
    );
    expect(shelves.map((shelf) => [shelf.label, shelf.rows.map((r) => r.id)])).toEqual([
      ['Today', ['run', 'today']],
      ['Yesterday', ['late-yesterday', 'early-yesterday']],
      ['Earlier', ['old', 'undated']],
    ]);
    expect(sessionShelves([row({ id: 'only', updatedMs: at(7, 1) })], now).map((shelf) => shelf.label)).toEqual(['Today']);
    expect(sessionShelves([], now)).toEqual([]);
  });

  it('lists the agents present, once each, in first-seen order', () => {
    expect(sessionAgents([row({ agent: 'codex' }), row({ agent: 'claude-code' }), row({ agent: 'codex' }), row({ agent: 'future' })])).toEqual([
      { id: 'codex', name: 'Codex' },
      { id: 'claude-code', name: 'Claude Code' },
      { id: 'future', name: 'future' },
    ]);
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
    expect(trashCaption({ ...entry, deletedMs: now - 2 * 60 * 60 * 1000 }, now)).toBe('Codex · solco · moved 2h ago');
    expect(trashCaption({ id: entry.id, agent: 'codex', title: 'x' }, now)).toBe('Codex');
  });

  it('words each refusal the Mac names and falls back to its own message', () => {
    expect(trashFailureMessage(new HostV3Error('http', 'x', { status: 409, code: 'session_in_use' }))).toMatch(/still using/);
    expect(trashFailureMessage(new HostV3Error('http', 'x', { status: 409, code: 'session_exists' }))).toMatch(/already exists/);
    expect(trashFailureMessage(new HostV3Error('http', 'Mac said so', { status: 400, code: 'something_new' }))).toBe('Mac said so');
    expect(trashFailureMessage(new Error('x'))).toBe('Something went wrong. Try again.');
  });
});
