import { describe, expect, it } from 'vitest';

import type { CoordinatorChat } from '@/contracts/host-v3';
import { coordinatorChatId, coordinatorHistoryFrame, isCoordinatorChatId } from '@/features/chat-web/coordinator-history';
import { toPageState } from '@/features/chat-web/page-state';

const chat: CoordinatorChat = {
  assistantId: 'a_1',
  provider: 'omp',
  model: 'm',
  hasOlder: true,
  working: true,
  turns: [{ user: true, text: 'remember the plan' }, { user: false, narration: 'Noted.', steps: [{ kind: 'narration', text: 'Noted.' }] }],
};

describe('an Assistant’s chat window while its Coordinator is stopped', () => {
  it('tells the window from a pane by its id', () => {
    expect(coordinatorChatId('a_1')).toBe('assistant-a_1');
    expect(isCoordinatorChatId('assistant-a_1')).toBe(true);
    expect(isCoordinatorChatId('assistant-')).toBe(false);
    expect(isCoordinatorChatId('w1:p1')).toBe(false);
    expect(isCoordinatorChatId('pending-abc')).toBe(false);
  });

  it('renders as an idle conversation: composer on, turns kept, no tail, earlier pages offered as the Mac says', () => {
    const frame = coordinatorHistoryFrame(chat);
    expect(frame).toMatchObject({ t: 'chat', paneId: 'assistant-a_1', agentStatus: 'idle' });
    expect(frame.state).not.toHaveProperty('working');
    expect(frame.state.hasOlder).toBe(true);
    const page = toPageState({ paneId: frame.paneId, seq: 1, frame });
    expect(page.disposition).toBe('ready');
    expect(page.readOnly).toBeUndefined();
    expect(page.hasOlder).toBe(true);
    expect(toPageState({ paneId: frame.paneId, seq: 1, frame: coordinatorHistoryFrame({ ...chat, hasOlder: false }) }).hasOlder).toBeUndefined();
    expect(page.turns.map((turn) => turn.user)).toEqual([true, false]);
  });

  it('shows the sent text under the history until the live stream carries it', () => {
    const frame = coordinatorHistoryFrame(chat);
    const page = toPageState({ paneId: frame.paneId, seq: 2, frame, echo: 'and ship Friday' });
    expect(page.turns.at(-1)).toMatchObject({ user: true, text: 'and ship Friday' });
    expect(page.echoPending).toBe(true);
  });
});
