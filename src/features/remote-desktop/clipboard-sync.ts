// [INPUT]: the last clipboard text each side is known to hold, and a freshly read text from one side.
// [OUTPUT]: `phoneRead` / `macRead` → { state, send | write } — what, if anything, to copy across.
// [POS]: The pure decision half of Remote Desktop clipboard auto-sync (use-clipboard-sync owns the polling).
//        The first reading of each side only seeds the state, so turning sync on never ships a clipboard that
//        was already there; afterwards a text that differs from the last known one is a real copy. After a copy
//        crosses, both sides hold the same text, so the echo of our own write is never sent back.
// [PROTOCOL]: 变更时更新此头部

export interface ClipState {
  phone: string | null;
  mac: string | null;
}

export const CLIP_START: ClipState = { phone: null, mac: null };

export function phoneRead(state: ClipState, text: string): { state: ClipState; send: string | null } {
  if (state.phone === null) return { state: { ...state, phone: text }, send: null };
  if (!text || text === state.phone) return { state, send: null };
  return { state: { phone: text, mac: text }, send: text };
}

export function macRead(state: ClipState, text: string): { state: ClipState; write: string | null } {
  if (state.mac === null) return { state: { ...state, mac: text }, write: null };
  if (!text || text === state.mac) return { state, write: null };
  return { state: { phone: text, mac: text }, write: text };
}
