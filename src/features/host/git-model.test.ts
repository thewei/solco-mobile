import { describe, expect, it } from 'vitest';

import type { GitDiff, GitFile, GitStatus, TreeWorkspace } from '@/contracts/host-v3';
import { HostV3Error } from '@/lib/host-client-v3';
import { branchLine, commitPlan, diffNotice, diffRows, fileParts, gitFailureMessage, gitWriteFailureMessage, groupFiles, groupPaths, statusBadge, summaryLine, syncActions, workspaceOfPane } from '@/features/host/git-model';

const file = (path: string, over: Partial<GitFile> = {}): GitFile => ({ path, status: 'modified', staged: false, unstaged: true, additions: 1, deletions: 0, ...over });
const status = (over: Partial<GitStatus> = {}): GitStatus => ({ workspaceId: 'w1', repo: true, branch: 'main', files: [], additions: 0, deletions: 0, ...over });

describe('groups', () => {
  it('sorts files into Staged / Changes / Untracked and drops empty groups', () => {
    const groups = groupFiles([
      file('a.go'),
      file('b.go', { staged: true, unstaged: false, status: 'added' }),
      file('c.go', { staged: true, unstaged: true }),
      file('new.txt', { status: 'untracked', staged: false, unstaged: false }),
    ]);
    expect(groups.map((g) => [g.key, g.files.map((f) => f.path)])).toEqual([
      ['staged', ['b.go', 'c.go']],
      ['changes', ['a.go', 'c.go']],
      ['untracked', ['new.txt']],
    ]);
    expect(groupFiles([])).toEqual([]);
  });
});

describe('words', () => {
  it('branch line carries ahead/behind, detached and unborn states', () => {
    expect(branchLine(status())).toBe('main');
    expect(branchLine(status({ upstream: { name: 'origin/main', ahead: 2, behind: 1 } }))).toBe('main · ↑2 ↓1');
    expect(branchLine(status({ upstream: { name: 'origin/main', ahead: 0, behind: 0 } }))).toBe('main');
    expect(branchLine(status({ branch: undefined, detached: true, head: 'abc1234' }))).toBe('Detached at abc1234');
    expect(branchLine(status({ branch: undefined }))).toBe('No commits yet');
  });

  it('summary line says clean, counts files and marks a cut list', () => {
    expect(summaryLine(status())).toBe('Working tree clean');
    expect(summaryLine(status({ files: [file('a')], additions: 3, deletions: 1 }))).toBe('1 file · +3 −1');
    expect(summaryLine(status({ files: [file('a'), file('b')], truncated: true }))).toBe('2+ files · +0 −0');
  });

  it('badges use Git letters and fall back for unknown words', () => {
    expect(statusBadge('modified')).toEqual({ letter: 'M', tone: 'change' });
    expect(statusBadge('untracked').letter).toBe('U');
    expect(statusBadge('brand-new')).toEqual({ letter: '?', tone: 'muted' });
  });

  it('file name first, folder as the caption', () => {
    expect(fileParts('src/app/index.tsx')).toEqual({ name: 'index.tsx', dir: 'src/app' });
    expect(fileParts('README.md')).toEqual({ name: 'README.md', dir: '' });
  });

  it('finds the Workspace of a pane', () => {
    const ws = [{ id: 'w1', label: 'a', tabs: [{ id: 't', label: 't', panes: [{ paneId: 'w1:p1' }] }] }] as unknown as TreeWorkspace[];
    expect(workspaceOfPane(ws, 'w1:p1')?.id).toBe('w1');
    expect(workspaceOfPane(ws, 'w9:p1')).toBeNull();
  });
});

describe('diff', () => {
  const diff = (over: Partial<GitDiff> = {}): GitDiff => ({
    path: 'a.go',
    status: 'modified',
    hunks: [{ header: '@@ -1,2 +1,2 @@', lines: [{ k: '-', o: 1, t: 'old' }, { k: '+', n: 1, t: 'new' }] }, { header: '@@ -9 +9 @@', lines: null }],
    ...over,
  });

  it('flattens hunks to keyed rows and tolerates a hunk without lines', () => {
    const rows = diffRows(diff());
    expect(rows.map((r) => r.type)).toEqual(['hunk', 'line', 'line', 'hunk']);
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
    expect(rows[1]).toMatchObject({ kind: '-', old: 1, text: 'old' });
  });

  it('explains why there is nothing (or not everything) to show', () => {
    expect(diffNotice(diff())).toBeNull();
    expect(diffNotice(diff({ binary: true, hunks: [] }))).toMatch(/Binary/);
    expect(diffNotice(diff({ tooLarge: true, hunks: [] }))).toMatch(/too large/);
    expect(diffNotice(diff({ hunks: [] }))).toMatch(/No line changes/);
    expect(diffNotice(diff({ truncated: true }))).toMatch(/first part/);
  });
});

describe('failure wording', () => {
  it('names the file-gone case and never leaks Host detail', () => {
    expect(gitFailureMessage(new HostV3Error('http', 'x', { status: 404, code: 'unknown_file' }))).toMatch(/no longer changed/);
    expect(gitFailureMessage(new HostV3Error('http', '/secret/path', { status: 502, code: 'git_failed' }))).not.toMatch(/secret/);
    expect(gitFailureMessage(new Error('boom'))).toMatch(/Something went wrong/);
  });
});

describe('git writes', () => {
  it('a group covers its own paths', () => {
    const groups = groupFiles([file('a.go'), file('b.go', { staged: true, unstaged: false })]);
    expect(groups.map(groupPaths)).toEqual([['b.go'], ['a.go']]);
  });

  it('commit takes the staged files and names the ones edited again after staging', () => {
    expect(commitPlan(status({ files: [file('a.go')] }))).toBeNull();
    expect(commitPlan(status({ files: [file('new.txt', { status: 'untracked', staged: false, unstaged: false })] }))).toBeNull();
    expect(
      commitPlan(status({ files: [file('a.go', { staged: true, unstaged: false }), file('b.go', { staged: true, unstaged: true }), file('c.go')] })),
    ).toEqual({ paths: ['a.go', 'b.go'], alsoUnstaged: ['b.go'] });
  });

  it('offers Fetch always, Pull when behind and Push when ahead, the last two behind a question', () => {
    expect(syncActions(status({ repo: false }))).toEqual([]);
    expect(syncActions(status({ head: 'abc1234', upstream: { name: 'origin/main', ahead: 0, behind: 0 } })).map((a) => a.op)).toEqual(['fetch']);
    const both = syncActions(status({ head: 'abc1234', upstream: { name: 'origin/main', ahead: 2, behind: 1 } }));
    expect(both.map((a) => [a.op, a.label, a.confirm?.title])).toEqual([
      ['fetch', 'Fetch', undefined],
      ['pull', 'Pull ↓1', 'Pull 1 commit from origin/main?'],
      ['push', 'Push ↑2', 'Push 2 commits to origin/main?'],
    ]);
  });

  it('publishes a branch with no upstream, and does nothing but Fetch on a detached HEAD', () => {
    expect(syncActions(status({ head: 'abc1234' })).map((a) => [a.op, a.label])).toEqual([['fetch', 'Fetch'], ['push', 'Publish']]);
    expect(syncActions(status({ branch: undefined, detached: true, head: 'abc1234' })).map((a) => a.op)).toEqual(['fetch']);
    // an unborn branch has nothing to publish
    expect(syncActions(status({})).map((a) => a.op)).toEqual(['fetch']);
  });

  it('words each refusal code and never echoes Git text', () => {
    const refusal = (code: string) => new HostV3Error('http', 'fatal: /secret/path', { status: 409, code });
    for (const code of ['git_stale', 'git_hook_failed', 'git_merge_in_progress', 'git_locked', 'git_rejected', 'git_no_upstream', 'git_detached', 'git_timeout', 'unknown_file']) {
      const text = gitWriteFailureMessage(refusal(code));
      expect(text.length).toBeGreaterThan(10);
      expect(text).not.toContain('secret');
    }
    expect(gitWriteFailureMessage(new Error('x'))).toBe('Something went wrong.');
  });
});
