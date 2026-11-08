// [INPUT]: a Host refusal code (+ message) from a send, queue or card answer.
// [OUTPUT]: refusalText — the one sentence the Chat page shows for it.
// [POS]: the phone's only Chat-specific wording; the conversation itself is the shared desktop page.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

const REFUSALS: Record<string, string> = {
  busy: 'The agent is working. Wait, or use “Send now” to cut in.',
  needs_terminal: 'This agent is waiting on a prompt that needs the terminal.',
  not_ready: 'The agent is not ready for a message yet.',
  no_agent: 'This pane is not running an agent.',
  delivery_uncertain: 'Delivery was not confirmed. Check the conversation before sending again.',
  interaction_gone: 'That prompt has already moved on.',
  unknown_option: 'That option is not on the prompt any more.',
  queue_unavailable: 'This session cannot queue a follow-up. Wait, or use “Send now”.',
  queue_blocked: 'An earlier follow-up may not have been delivered. Check the agent before queueing more.',
  queue_failed: 'The follow-up could not be queued.',
  no_queued: 'There is no queued follow-up any more.',
  already_delivered: 'The follow-up has already been delivered.',
  unknown_subagent: 'That sub-agent is no longer part of this conversation.',
  subagent_unavailable: 'Could not open that sub-agent.',
  attachment_too_large: 'That file is larger than 32 MB.',
  attach_failed: 'That file could not be saved.',
  attach_unavailable: 'Attachments are not enabled on the computer.',
  voice_unavailable: 'No voice source is set up. Choose one in Solco → Settings → Voice.',
  audio_too_large: 'That recording is too long. Keep it under a minute.',
};

export function refusalText(code: string | undefined, message: string | undefined): string {
  if (code === 'refused' && message) return `The agent refused it: ${message}`;
  if (code === 'transcribe_failed' && message) return `Transcription failed: ${message}`;
  return (code && REFUSALS[code]) || message || 'The message was not sent.';
}
