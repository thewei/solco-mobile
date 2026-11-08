import { describe, expect, it } from 'vitest';

import type { FileContent } from '@/contracts/host-v3';

import { HostV3Error } from '@/lib/host-client-v3';

import { attachText, baseName, codeLines, markWords, openable, parentDir, previewNotice, searchFailure, searchNote, sizeLabel } from './files-model';

const file = (patch: Partial<FileContent>): FileContent => ({ workspaceId: 'w1', path: 'a', name: 'a', flavor: 'text', size: 1, ...patch });

describe('files model', () => {
  it('walks paths up one level', () => {
    expect(parentDir('src/lib/a.ts')).toBe('src/lib');
    expect(parentDir('README.md')).toBe('');
    expect(baseName('src/lib/a.ts')).toBe('a.ts');
  });
  it('labels sizes', () => {
    expect([sizeLabel(12), sizeLabel(1536), sizeLabel(20 * 1024), sizeLabel(3 * 1024 * 1024)]).toEqual(['12 B', '1.5 KB', '20 KB', '3.0 MB']);
  });
  it('opens folders and files, never a link', () => {
    expect(openable({ name: 'a', path: 'a', kind: 'dir', size: 0 })).toBe(true);
    expect(openable({ name: 'a', path: 'a', kind: 'symlink', size: 0 })).toBe(false);
  });
  it('spells the @ mention the agents read', () => {
    expect(attachText('src/a.go')).toBe('@src/a.go ');
    expect(attachText('my docs/a b.md')).toBe('@"my docs/a b.md" ');
  });
  it('splits text without a phantom last row', () => {
    expect(codeLines('a\nb\n')).toEqual(['a', 'b']);
    expect(codeLines('')).toEqual(['']);
  });
  it('says why a preview is partial', () => {
    expect(previewNotice(file({}))).toBeNull();
    expect(previewNotice(file({ flavor: 'binary', size: 3 }))).toMatch(/Binary/);
    expect(previewNotice(file({ flavor: 'image', tooLarge: true, size: 5 * 1024 * 1024 }))).toMatch(/too large/);
    expect(previewNotice(file({ truncated: true, size: 2 * 1024 * 1024 }))).toMatch(/first 1 MB/);
  });
  it('marks every typed word in a name, whatever its case, and nothing else', () => {
    expect(markWords('personal_agent_coordinator_chat.go', 'coordinator')).toEqual([['personal_agent_', false], ['coordinator', true], ['_chat.go', false]]);
    expect(markWords('personal_agent_coordinator_chat.go', 'chat coordinator')).toEqual([['personal_agent_', false], ['coordinator', true], ['_', false], ['chat', true], ['.go', false]]);
    expect(markWords('Button.tsx', 'BUTTON ts')).toEqual([['Button', true], ['.', false], ['ts', true], ['x', false]]);
    expect(markWords('a.ts.ts', 'ts')).toEqual([['a.', false], ['ts', true], ['.', false], ['ts', true]]);
  });
  it('prefers the longer word where two typed words start at the same place, and treats regex characters as text', () => {
    expect(markWords('index.tsx', 'ts tsx')).toEqual([['index.', false], ['tsx', true]]);
    expect(markWords('a+b(1).ts', '+b( .')).toEqual([['a', false], ['+b(', true], ['1)', false], ['.', true], ['ts', false]]);
  });
  it('leaves a name without a typed word as one plain run', () => {
    expect(markWords('utils.ts', 'src')).toEqual([['utils.ts', false]]);
    expect(markWords('utils.ts', '   ')).toEqual([['utils.ts', false]]);
  });
  it('notes the matches that did not fit and a workspace too large to search completely', () => {
    const fifty = Array.from({ length: 50 }, (_, i) => `f${i}.go`);
    expect(searchNote({ hits: ['a.go', 'b.go'], total: 2 })).toBeNull();
    expect(searchNote({ hits: fifty, total: 312 })).toBe('Showing the first 50 of 312 matches. Add a word to narrow them.');
    expect(searchNote({ hits: ['a.go'], total: 1, truncated: true })).toBe('This workspace is too large to search completely, so some files may be missing.');
    expect(searchNote({ hits: fifty, total: 50, truncated: true })).not.toMatch(/Showing/);
  });
  it('says why a search failed: no engine has no retry, a lost connection and anything else do', () => {
    expect(searchFailure(new HostV3Error('http', 'x', { status: 502, code: 'search_unavailable' }), 'Mac')).toMatchObject({ title: 'Search unavailable', retry: false });
    expect(searchFailure(new HostV3Error('transport', 'timed out'), 'Wilson-MacBook-Pro')).toEqual({ title: 'Search failed', text: 'Can’t reach Wilson-MacBook-Pro. Check the connection, then try again.', retry: true });
    expect(searchFailure(new HostV3Error('http', 'x', { status: 502, code: 'files_failed' }), 'Mac')).toMatchObject({ title: 'Search failed', retry: true });
    expect(searchFailure(new Error('boom'), 'Mac')).toMatchObject({ retry: true });
  });
});
