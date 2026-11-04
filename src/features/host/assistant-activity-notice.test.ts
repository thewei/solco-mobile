import { describe, expect, it, vi } from 'vitest';

import type { AssistantActivityPage, AssistantOverview, Fact } from '@/contracts/host-v3';
import { assistantActivityNotice, createAssistantActivityNoticePump } from './assistant-activity-notice';

const fact = (kind = 'pulse', seq = 7): Fact => ({
  seq, id: 'f_' + seq, assistantId: 'a_1', kind,
  text: 'PRIVATE TASK NAME, prompt and secret must never enter a lockscreen notice',
  evidence: 'secret-evidence', createdAt: 1,
});
const overview: AssistantOverview = {
  schema: 1, needsYou: 0,
  assistants: [{ id: 'a_1', name: 'Private profile name', status: 'active', revision: 1,
    goals: 1, tasks: 2, running: 1, queued: 0, done: 0, needsYou: 0, approvals: 0, updatedAt: 1 }],
  groups: [],
};
const page = (ackSeq = 0): AssistantActivityPage => ({
  schema: 1, facts: ackSeq >= 7 ? [] : [fact()], nextSeq: ackSeq >= 7 ? ackSeq : 7, ackSeq, hasMore: false,
});

describe('Assistant Activity notification pump', () => {
  it('never exposes task content in Android notifications', () => {
    const notice = assistantActivityNotice('a_1', [fact('blocked')]);
    const text = JSON.stringify(notice);
    expect(notice.title).toContain('needs you');
    expect(notice.body).toContain('review needed');
    expect(text).not.toMatch(/PRIVATE|secret|profile name|prompt|evidence/i);
    expect(notice.data.route).toBe(JSON.stringify({ pathname: '/assistants/activity/[id]', params: { id: 'a_1' } }));
  });

  it('posts once and advances only the dedicated notification cursor', async () => {
    let seenAck = 0;
    const schedule = vi.fn(async () => {});
    const ack = vi.fn(async (_requestId: string, _id: string, seq: number) => { seenAck = seq; return seq; });
    const pump = createAssistantActivityNoticePump({
      overview: async () => overview, unread: async () => page(seenAck),
      ack, schedule, nextRequestId: () => 'rid', isCurrent: () => true,
    });
    await pump.poll();
    await pump.poll();
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(ack).toHaveBeenCalledWith('rid', 'a_1', 7);
    expect(seenAck).toBe(7);
  });

  it('defers notices during Assistant quiet hours without ACKing them', async () => {
    let quiet = true;
    const schedule = vi.fn(async () => {});
    const ack = vi.fn(async () => 7);
    const pump = createAssistantActivityNoticePump({
      overview: async () => overview, unread: async () => page(0),
      mayNotify: async () => !quiet,
      ack, schedule, nextRequestId: () => 'rid', isCurrent: () => true,
    });
    await pump.poll();
    expect(schedule).not.toHaveBeenCalled();
    expect(ack).not.toHaveBeenCalled();
    quiet = false;
    await pump.poll();
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(ack).toHaveBeenCalledTimes(1);
  });

  it('failed OS scheduling cannot ACK or lose the fact', async () => {
    let n = 0;
    const schedule = vi.fn(async () => { if (++n === 1) throw new Error('permission denied'); });
    const ack = vi.fn(async () => 7);
    const pump = createAssistantActivityNoticePump({
      overview: async () => overview, unread: async () => page(0),
      ack, schedule, nextRequestId: () => 'rid', isCurrent: () => true,
    });
    await pump.poll();
    expect(ack).not.toHaveBeenCalled();
    await pump.poll();
    expect(schedule).toHaveBeenCalledTimes(2);
    expect(ack).toHaveBeenCalledTimes(1);
  });

  it('retries the same uncertain ACK without reposting a scheduled notice', async () => {
    const schedule = vi.fn(async () => {});
    let attempts = 0;
    const ack = vi.fn(async () => { if (++attempts === 1) throw new Error('transport lost'); return 7; });
    let nextID = 0;
    const pump = createAssistantActivityNoticePump({
      overview: async () => overview, unread: async () => page(0),
      ack, schedule, nextRequestId: () => 'rid-' + ++nextID, isCurrent: () => true,
    });
    await pump.poll();
    await pump.poll();
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(ack).toHaveBeenCalledTimes(2);
    expect(ack.mock.calls[0]).toEqual(ack.mock.calls[1]);
  });

  it('does not publish a stale Host result after switching Macs', async () => {
    let active = true;
    const schedule = vi.fn(async () => {});
    const pump = createAssistantActivityNoticePump({
      overview: async () => { active = false; return overview; },
      unread: async () => page(), ack: async () => 7, schedule,
      nextRequestId: () => 'rid', isCurrent: () => active,
    });
    await pump.poll();
    expect(schedule).not.toHaveBeenCalled();
  });

  it('batches multiple committed facts into one notification', () => {
    const notice = assistantActivityNotice('a_1', [fact('task_added', 7), fact('verified', 8), fact('pulse', 9)]);
    expect(notice.body).toBe('3 new task updates');
  });
});
