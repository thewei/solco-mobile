// [INPUT]: mobile Host Chat full frames and bounded suffix deltas, including bad baselines.
// [OUTPUT]: immutable merge on exact seq/pane, fail closed on gaps/rolling windows.
// [POS]: SC-06 transport reducer; requires no running Host or WebView.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { describe, expect, it } from 'vitest';
import { chatDeltaFrameSchema, chatFrameSchema } from '@/contracts/host-v3';
import { applyHostChatDelta } from './host-delta';

const source = () => chatFrameSchema.parse({
  t: 'chat', paneId: 'w1:p1', seq: 51, agentStatus: 'working',
  state: {
    provider: 'omp',
    turns: Array.from({ length: 30 }, (_, i) => ({ user: false, narration: `t-${i}` })),
  },
});

describe('Host Chat delta', () => {
  it('merges a bounded suffix immutably and advances only the expected sequence', () => {
    const base = source();
    const delta = chatDeltaFrameSchema.parse({
      t: 'chat_delta', paneId: 'w1:p1', baseSeq: 51, seq: 52, start: 27,
      turns: [
        { user: false, narration: 't-27' },
        { user: false, narration: 't-28' },
        { user: false, narration: 'streaming' },
      ],
    });
    const next = applyHostChatDelta(base, delta);
    expect(next?.seq).toBe(52);
    expect(next?.state.turns).toHaveLength(30);
    expect(next?.state.turns[29]?.narration).toBe('streaming');
    expect(base.state.turns[29]?.narration).toBe('t-29');
  });

  it('refuses gaps, wrong Pane, absent baseline and invalid suffix positions', () => {
    const base = source();
    const delta = chatDeltaFrameSchema.parse({
      t: 'chat_delta', paneId: base.paneId, baseSeq: 51, seq: 52, start: 27,
      turns: [{ user: false, narration: 'hello' }],
    });
    expect(applyHostChatDelta(null, delta)).toBeNull();
    expect(applyHostChatDelta({ ...base, seq: undefined }, delta)).toBeNull();
    expect(applyHostChatDelta(base, { ...delta, baseSeq: 50 })).toBeNull();
    expect(applyHostChatDelta(base, { ...delta, paneId: 'other' })).toBeNull();
    expect(applyHostChatDelta(base, { ...delta, start: 50 })).toBeNull();
    expect(applyHostChatDelta(base, { ...delta, seq: 51 })).toBeNull();
    expect(chatDeltaFrameSchema.safeParse({ ...delta, turns: Array(4).fill({ user: false }) }).success).toBe(false);
  });
});
