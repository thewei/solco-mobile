// [INPUT]: an Assistant's previous Coordinator conversation (Host `GET …/coordinator/chat`, read-only, addressed by Assistant).
// [OUTPUT]: `COORDINATOR_CHAT_PREFIX` (the conversation id of an Assistant's chat window, `assistant-<id>`), `coordinatorChatId`,
//           `isCoordinatorChatId`, `coordinatorHistoryFrame` — the chat frame the shared page renders for it.
// [POS]: pure adapter for the phone's Assistant window while its Coordinator is not running (2026-11-07): the same page the live
//        pane uses, fed a frame that says "idle" so the composer is on and a send starts the Coordinator (the screen does that).
//        The Mac states what is true (turns, model, plan, whether earlier pages exist); this only drops what a stopped agent
//        cannot honour — a streaming tail. "Earlier messages" is answered by the screen asking the Host for a longer window.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import type { ChatFrame, CoordinatorChat } from '@/contracts/host-v3';

export const COORDINATOR_CHAT_PREFIX = 'assistant-';

/** The id under which the page, its draft store and the controller know an Assistant's chat window. */
export const coordinatorChatId = (assistantId: string): string => `${COORDINATOR_CHAT_PREFIX}${assistantId}`;

/** A pane id never starts like this (Herdr names them `w1:p1`), so a route param tells the window from a pane. */
export const isCoordinatorChatId = (id: string): boolean => id.startsWith(COORDINATOR_CHAT_PREFIX) && id.length > COORDINATOR_CHAT_PREFIX.length;

export function coordinatorHistoryFrame(chat: CoordinatorChat): ChatFrame {
  // Not carried: `working` — a tail the stopped agent will never finish.
  const { assistantId, working, ...state } = chat;
  void working;
  return { t: 'chat', paneId: coordinatorChatId(assistantId), agentStatus: 'idle', state };
}
