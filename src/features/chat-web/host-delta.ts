// [INPUT]: one verified Host 'chat_delta' suffix and the last delivered full ChatFrame.
// [OUTPUT]: a new immutable ChatFrame, or null (caller must request a canonical Host snapshot).
// [POS]: SC-06 wire reducer before the mobile Chat controller, never part of the WebView's own bridge.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import type { ChatDeltaFrame, ChatFrame } from '@/contracts/host-v3';

/** Never guess a missing Token or extend a shifted conversation window. */
export function applyHostChatDelta(base: ChatFrame | null, delta: ChatDeltaFrame): ChatFrame | null {
  if (!base || base.seq === undefined || base.seq !== delta.baseSeq ||
      delta.seq !== delta.baseSeq + 1 || delta.paneId !== base.paneId ||
      delta.turns.length > 3 || delta.start > base.state.turns.length ||
      delta.start < Math.max(0, base.state.turns.length - 3)) {
    return null;
  }
  return {
    ...base,
    seq: delta.seq,
    state: {
      ...base.state,
      turns: [...base.state.turns.slice(0, delta.start), ...delta.turns],
    },
  };
}
