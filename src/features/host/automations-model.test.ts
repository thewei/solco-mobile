import { describe, expect, it } from 'vitest';

import type { AutomationDetail, AutomationItem, TreeWorkspace } from '@/contracts/host-v3';
import {
  automationActionMessage,
  automationAgentName,
  automationTone,
  emptyForm,
  fieldsOfForm,
  formFromDetail,
  formProblem,
  nextLine,
  openablePane,
  runLine,
  runRowLine,
  sortAutomations,
  stateLine,
} from '@/features/host/automations-model';
import { HostV3Error } from '@/lib/host-client-v3';

const NOW = 1_786_050_000_000;
const item = (over: Partial<AutomationItem> & { name: string }): AutomationItem => ({ state: 'active', ...over });

describe('automations model', () => {
  it('names the plugin agent kinds and passes unknown ones through', () => {
    expect(automationAgentName('claude')).toBe('Claude Code');
    expect(automationAgentName('agy')).toBe('Antigravity');
    expect(automationAgentName('mystery')).toBe('mystery');
    expect(automationAgentName(undefined)).toBe('');
  });

  it('orders what needs you first: failed, draft, running, unread, the rest', () => {
    const sorted = sortAutomations([
      item({ name: 'e', state: 'paused' }),
      item({ name: 'd', unread: true, lastRun: { id: '1', status: 'done' } }),
      item({ name: 'c', lastRun: { id: '2', status: 'running' } }),
      item({ name: 'b', state: 'draft' }),
      item({ name: 'a', lastRun: { id: '3', status: 'failed' } }),
    ]);
    expect(sorted.map((i) => i.name)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(automationTone(sorted[0]!)).toBe('danger');
  });

  it('words the newest run', () => {
    expect(runLine(item({ name: 'x', lastRun: { id: '1', status: 'failed', atMs: NOW - 3 * 3_600_000, durationSec: 31 } }), NOW)).toBe('Failed 3h ago · 31s');
    expect(runLine(item({ name: 'x', lastRun: { id: '1', status: 'running', atMs: NOW } }), NOW)).toBe('Running');
    expect(runLine(item({ name: 'x' }), NOW)).toBe('Never run');
    expect(runLine(item({ name: 'x', state: 'draft' }), NOW)).toBe('Not scheduled until approved');
  });

  it('says when it runs next only while it is scheduled', () => {
    expect(nextLine(item({ name: 'x', nextRunMs: NOW + 4 * 3_600_000 }), NOW)).toBe('Next in 4h 0m');
    expect(nextLine(item({ name: 'x', state: 'paused', nextRunMs: NOW + 1000 }), NOW)).toBeNull();
  });

  it('captions the row with state, schedule, agent and mode', () => {
    expect(stateLine(item({ name: 'x', schedule: 'Daily 03:00', agent: 'claude', headless: true }))).toBe('Daily 03:00 · Claude Code · Headless');
    expect(stateLine(item({ name: 'x', state: 'draft', schedule: 'Daily 09:00', agent: 'codex' }))).toBe('Draft · Daily 09:00 · Codex');
  });
});

describe('automations management model', () => {
  const full = { ...emptyForm('claude'), name: 'nightly', cron: '0 3 * * *', repo: '/work/api', prompt: 'Triage CI.' };

  it('asks only for what a write needs and leaves judgement to the plugin', () => {
    expect(formProblem(emptyForm('claude'), true)).toBe('Give it a name.');
    expect(formProblem({ ...full, name: 'bad name!' }, true)).toMatch(/letters, digits/);
    expect(formProblem({ ...full, cron: ' ' }, true)).toBe('Pick a schedule.');
    expect(formProblem({ ...full, repo: '' }, true)).toBe('Choose a repository.');
    expect(formProblem({ ...full, agent: '' }, true)).toBe('Pick an agent.');
    expect(formProblem({ ...full, prompt: '  ' }, true)).toBe('Write the prompt.');
    expect(formProblem({ ...full, timeoutMinutes: '12x' }, true)).toBe('Timeout must be a whole number.');
    expect(formProblem(full, true)).toBeNull();
    // an edit never asks for the name: it is the key
    expect(formProblem({ ...full, name: '' }, false)).toBeNull();
    // a cron that is nonsense is the plugin's to refuse, not the phone's
    expect(formProblem({ ...full, cron: 'nonsense' }, true)).toBeNull();
  });

  it('keeps empty text and zero off the wire', () => {
    expect(fieldsOfForm(full)).toEqual({
      cron: '0 3 * * *', repo: '/work/api', workspace: 'worktree', agent: 'claude', model: undefined,
      prompt: 'Triage CI.', rationale: undefined, onOverlap: 'skip', headless: undefined,
      timeoutMinutes: undefined, catchUpMinutes: undefined, cleanupTtlHours: undefined,
    });
    expect(fieldsOfForm({ ...full, headless: true, timeoutMinutes: '45', catchUpMinutes: '0', cleanupTtlHours: ' 72 ' })).toMatchObject({
      headless: true, timeoutMinutes: 45, catchUpMinutes: undefined, cleanupTtlHours: 72,
    });
  });

  it('round-trips a detail through the form', () => {
    const detail: AutomationDetail = {
      name: 'nightly', state: 'active', cron: '0 3 * * *', repo: '/work/api', workspace: 'root', agent: 'codex', prompt: 'p',
      rationale: 'r', onOverlap: 'queue', headless: true, timeoutMinutes: 45, runs: [],
    };
    const form = formFromDetail(detail);
    expect(form).toMatchObject({ workspace: 'root', onOverlap: 'queue', headless: true, timeoutMinutes: '45', catchUpMinutes: '' });
    expect(fieldsOfForm(form)).toMatchObject({ cron: '0 3 * * *', workspace: 'root', agent: 'codex', onOverlap: 'queue', headless: true, timeoutMinutes: 45 });
  });

  it('words a run row and finds its pane only while the phone still lists it', () => {
    const run = { id: 'run-7', status: 'failed', trigger: 'schedule', atMs: NOW - 3 * 3_600_000, durationSec: 31, paneId: 'p_9' };
    expect(runRowLine(run, NOW)).toBe('Failed · Scheduled · 3h ago · 31s');
    expect(runRowLine({ id: 'r', status: 'running', trigger: 'manual' }, NOW)).toBe('Running · Run now');
    const tree = [{ tabs: [{ label: 't', panes: [{ paneId: 'p_9' }] }] }] as unknown as TreeWorkspace[];
    expect(openablePane(run, tree)?.paneId).toBe('p_9');
    expect(openablePane({ ...run, paneId: 'gone' }, tree)).toBeNull();
    expect(openablePane({ id: 'r', status: 'done' }, tree)).toBeNull();
  });

  it('shows the plugin\'s own sentence for a refusal and ours for the rest', () => {
    expect(automationActionMessage(new HostV3Error('http', 'cron: expected 5 fields', { status: 422, code: 'automation_refused' }))).toBe('cron: expected 5 fields');
    expect(automationActionMessage(new HostV3Error('http', 'x', { status: 404, code: 'unknown_automation' }))).toBe('That automation no longer exists.');
    expect(automationActionMessage(new HostV3Error('transport', 'x'))).toMatch(/Could not reach/);
    expect(automationActionMessage(new Error('boom'))).toMatch(/did not answer/);
  });
});
