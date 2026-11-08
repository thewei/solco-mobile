// [INPUT]: nothing (pure types and limits).
// [OUTPUT]: `PickedAttachment` (one file the user chose, as the Host upload carries it) and the size ceiling.
// [POS]: the seam between the system file picker (`pick-attachment`, native/web) and the Chat controller.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
// Invariants: the ceiling equals the Host's (internal/chatattach MaxFile); a file over it never leaves the phone.

export interface PickedAttachment {
  dataBase64: string;
  mime: string;
  name: string;
}

export const MAX_ATTACHMENT_BYTES = 32 * 1024 * 1024;

export const ATTACHMENT_TOO_LARGE = 'That file is larger than 32 MB.';
