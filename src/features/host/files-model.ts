// [INPUT]: the Host's read-only Files answers (FilesList / FileContent / FilesSearch) and a failure.
// [OUTPUT]: parentDir, baseName, sizeLabel, openable, attachText, codeLines, previewNotice, filesFailureMessage, markWords, searchNote, searchFailure.
// [POS]: Pure presentation model of the phone's Files view: folder navigation, labels and the `@path` mention that
//        "Attach to chat" puts into an agent's draft. No IO; paths are only ever ones the Host listed.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import type { FileContent, FileEntry, FilesSearch } from '@/contracts/host-v3';
import { HostV3Error } from '@/lib/host-client-v3';

export function baseName(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? path : path.slice(i + 1);
}

/** The folder one level up ('' = the Workspace's own folder). */
export function parentDir(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

export function sizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(bytes >= 10 * 1024 ? 0 : 1)} KB`;
  return `${bytes} B`;
}

/** A symlink is shown but not followed (the Host's rule), so only folders and plain files open. */
export function openable(entry: FileEntry): boolean {
  return entry.kind === 'dir' || entry.kind === 'file';
}

/** The `@path` mention agents read (`@"…"` when the path holds whitespace), with the trailing space the composer expects. */
export function attachText(path: string): string {
  return /\s/.test(path) ? `@"${path}" ` : `@${path} `;
}

/** Text split into rows for a virtualized list (one trailing newline does not add an empty row). */
export function codeLines(content: string): string[] {
  const lines = content.split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** The one sentence under a preview that cannot (fully) show; null when the whole file is shown. */
export function previewNotice(file: FileContent): string | null {
  if (file.flavor === 'binary') return `Binary file · ${sizeLabel(file.size)} — no preview.`;
  if (file.flavor === 'image' && file.tooLarge) return `This image is ${sizeLabel(file.size)} — too large to show on the phone.`;
  if (file.flavor === 'image' && file.dataUrl?.startsWith('data:image/svg+xml')) return 'SVG pictures are not drawn on the phone.';
  if (file.truncated) return `Large file (${sizeLabel(file.size)}) — showing the first 1 MB.`;
  return null;
}

export function filesFailureMessage(error: unknown): string {
  if (!(error instanceof HostV3Error)) return 'Something went wrong. Pull to retry.';
  switch (error.code) {
    case 'files_unavailable':
      return 'Files are not enabled on the computer.';
    case 'unknown_workspace':
      return 'That workspace is gone.';
    case 'workspace_no_directory':
      return 'That workspace has no folder.';
    case 'unknown_file':
      return 'That file or folder is gone. Go back and refresh.';
    case 'files_failed':
      return 'The folder could not be read.';
    case 'bad_request':
      return 'That path can’t be opened.';
    default:
      return error.kind === 'transport' ? 'Can’t reach the computer. Pull to retry.' : 'Something went wrong. Pull to retry.';
  }
}

/** `text` cut into runs, each flagged when it is one of the typed words (case-insensitive, every occurrence); one unflagged run when none is. */
export function markWords(text: string, query: string): [string, boolean][] {
  const words = query.split(/\s+/).filter(Boolean).sort((a, b) => b.length - a.length).map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (words.length === 0) return [[text, false]];
  const runs: [string, boolean][] = [];
  let at = 0;
  for (const found of text.matchAll(new RegExp(words.join('|'), 'gi'))) {
    if (found.index > at) runs.push([text.slice(at, found.index), false]);
    runs.push([found[0], true]);
    at = found.index + found[0].length;
  }
  if (at < text.length) runs.push([text.slice(at), false]);
  return runs;
}

/** The note under search results: how many more matched than fit, and a workspace too large to search completely; null when there is nothing to add. */
export function searchNote(search: Pick<FilesSearch, 'hits' | 'total' | 'truncated'>): string | null {
  const parts: string[] = [];
  if (search.total > search.hits.length) parts.push(`Showing the first ${search.hits.length} of ${search.total} matches. Add a word to narrow them.`);
  if (search.truncated) parts.push('This workspace is too large to search completely, so some files may be missing.');
  return parts.length > 0 ? parts.join(' ') : null;
}

/** What a failed search says: its own sentence when the computer cannot list files at all (no retry helps), otherwise a retry. */
export function searchFailure(error: unknown, hostName: string): { title: string; text: string; retry: boolean } {
  if (error instanceof HostV3Error && error.code === 'search_unavailable') {
    return { title: 'Search unavailable', text: 'The computer needs Git or ripgrep installed to search file names. You can still browse the tree.', retry: false };
  }
  if (error instanceof HostV3Error && error.kind === 'transport') {
    return { title: 'Search failed', text: `Can’t reach ${hostName}. Check the connection, then try again.`, retry: true };
  }
  return { title: 'Search failed', text: 'The search didn’t finish. Try again.', retry: true };
}
