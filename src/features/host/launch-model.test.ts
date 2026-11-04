import { describe, expect, it } from 'vitest';

import { launchRequestSchema, type TreeWorkspace } from '@/contracts/host-v3';
import { HostV3Error } from '@/lib/host-client-v3';
import {
  buildLaunchBody,
  createLaunchAttempts,
  defaultTarget,
  knownFolders,
  draftFolder,
  launchFailureMessage,
  launchRoute,
  newRequestId,
  validFolder,
  workspaceTargets,
} from '@/features/host/launch-model';

const pane = (id: string, cwd?: string) => ({ paneId: id, terminalId: `t_${id}`, cwd });
const workspaces: TreeWorkspace[] = [
  { id: 'w1', label: 'solco', status: 'idle', cwd: '/Users/me/solco', tabs: [{ id: 'tab1', label: 'a', status: 'idle', panes: [pane('p1', '/Users/me/solco'), pane('p2', '/Users/me/other')] }] },
  { id: 'w2', label: 'nodir', status: 'idle', tabs: [{ id: 'tab2', label: 'b', status: 'idle', panes: [pane('p3', '/Users/me/other')] }] },
];

describe('launch targets', () => {
  it('lists only workspaces with a folder, and suggests other pane folders once', () => {
    expect(workspaceTargets(workspaces).map((t) => t.type === 'workspace' && t.id)).toEqual(['w1']);
    expect(defaultTarget(workspaces)).toMatchObject({ id: 'w1' });
    expect(knownFolders(workspaces)).toEqual(['/Users/me/other']);
    expect(defaultTarget([])).toBeNull();
  });

  it('accepts only absolute clean folders', () => {
    expect(validFolder('/Users/me/p')).toBe(true);
    for (const bad of ['', 'relative/p', '~/p', '/a/../b', '/a\u0000b']) expect(validFolder(bad)).toBe(false);
  });
});

describe('buildLaunchBody', () => {
  const ws = { type: 'workspace', id: 'w1', label: 'solco', cwd: '/x' } as const;
  it('builds requests the contract (and so the Host) accepts', () => {
    const agent = buildLaunchBody({ target: ws, kind: 'claude-code', prompt: '  fix it  ' });
    expect(agent).toEqual({ workspaceId: 'w1', kind: 'claude-code', prompt: 'fix it' });
    expect(launchRequestSchema.safeParse({ ...agent, requestId: 'req_0123456789' }).success).toBe(true);
    const path = buildLaunchBody({ target: { type: 'path', path: ' /Users/me/p ' }, kind: 'codex', prompt: '' });
    expect(path).toEqual({ path: '/Users/me/p', kind: 'codex' });
    expect(launchRequestSchema.safeParse({ ...path, requestId: 'req_0123456789' }).success).toBe(true);
  });

  it('sends a Terminal its first command as one line, or nothing', () => {
    const body = buildLaunchBody({ target: ws, kind: 'terminal', prompt: ' ls -la\n' });
    expect(body.prompt).toBe('ls -la');
    expect(launchRequestSchema.safeParse({ ...body, requestId: 'req_0123456789' }).success).toBe(true);
    expect(buildLaunchBody({ target: ws, kind: 'terminal', prompt: 'cd a\nrm b' }).prompt).toBe('cd a rm b');
    expect(buildLaunchBody({ target: ws, kind: 'terminal', prompt: '  \n ' }).prompt).toBeUndefined();
    expect(launchRequestSchema.safeParse({ ...body, prompt: 'a\nb', requestId: 'req_0123456789' }).success).toBe(false);
  });

  it('names a draft folder like the launch does', () => {
    expect(draftFolder(ws)).toEqual({ workspaceId: 'w1' });
    expect(draftFolder({ type: 'path', path: ' /Users/me/p ' })).toEqual({ path: '/Users/me/p' });
  });

  it('generates ids the Host accepts', () => {
    expect(newRequestId()).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(newRequestId()).not.toBe(newRequestId());
  });
});

describe('request id lifecycle', () => {
  const request = { workspaceId: 'w1', kind: 'codex' };
  const make = () => {
    let n = 0;
    return createLaunchAttempts(() => `req_${++n}xxxxxxx`);
  };

  it('reuses the id after a transport failure (the Host may have finished it) and replays safely', () => {
    const attempts = make();
    const first = attempts.begin(request);
    attempts.settle(new HostV3Error('transport', 'timeout'));
    expect(attempts.begin(request)).toBe(first);
  });

  it('starts afresh after success, a Host answer, or a changed request', () => {
    const attempts = make();
    const first = attempts.begin(request);
    attempts.settle(null);
    expect(attempts.begin(request)).not.toBe(first);

    const second = attempts.begin(request);
    attempts.settle(new HostV3Error('http', 'x', { status: 400, code: 'path_unavailable' }));
    expect(attempts.begin(request)).not.toBe(second);

    const third = attempts.begin(request);
    attempts.settle(new HostV3Error('transport', 'timeout'));
    expect(attempts.begin({ ...request, prompt: 'changed' })).not.toBe(third);
  });
});

describe('where a fresh pane opens', () => {
  const reply = { paneId: 'w1:p9', terminalId: 't9', workspaceId: 'w1', agent: true };
  it('agent → Chat when served, otherwise (and for Terminal) the terminal', () => {
    expect(launchRoute(reply, 'default', 'Codex', true).pathname).toBe('/chat/[paneId]');
    expect(launchRoute(reply, 'default', 'Codex', false).pathname).toBe('/terminal/[terminalId]');
    expect(launchRoute({ ...reply, agent: false }, 'default', 'Terminal', true).pathname).toBe('/terminal/[terminalId]');
  });
  it('a blocked agent (trust prompt) opens its Chat with the undelivered prompt as the draft', () => {
    const route = launchRoute({ ...reply, promptPending: true }, 'default', 'Claude Code', true, '  fix the test ');
    expect(route.pathname).toBe('/chat/[paneId]');
    expect('draft' in route.params ? route.params.draft : undefined).toBe('fix the test');
    // A delivered prompt (or none) carries no draft.
    expect('draft' in launchRoute(reply, 'default', 'Codex', true, 'hello').params).toBe(false);
    expect('draft' in launchRoute({ ...reply, promptPending: true }, 'default', 'Claude Code', true, '').params).toBe(false);
  });
});

describe('failure wording', () => {
  it('names the uncertain case without inviting a blind retry', () => {
    const uncertain = new HostV3Error('http', 'x', { status: 504, code: 'launch_uncertain' });
    expect(launchFailureMessage(uncertain)).toMatch(/Check the session list/);
    expect(launchFailureMessage(new HostV3Error('transport', 'x'))).toMatch(/safe/);
    expect(launchFailureMessage(new HostV3Error('http', 'x', { status: 400, code: 'path_unavailable' }))).toMatch(/folder/);
  });
});
