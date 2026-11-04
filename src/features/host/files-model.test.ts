import { describe, expect, it } from 'vitest';

import type { FileContent } from '@/contracts/host-v3';

import { attachText, baseName, codeLines, openable, parentDir, previewNotice, sizeLabel } from './files-model';

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
});
