// [INPUT]: the Host's read-only Files answers (FilesList / FileContent) and a failure.
// [OUTPUT]: parentDir, baseName, sizeLabel, openable, attachText, codeLines, previewNotice, filesFailureMessage.
// [POS]: Pure presentation model of the phone's Files view: folder navigation, labels and the `@path` mention that
//        "Attach to chat" puts into an agent's draft. No IO; paths are only ever ones the Host listed.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import type { FileContent, FileEntry } from '@/contracts/host-v3';
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
