import { describe, expect, it, vi } from 'vitest';

import type { AssistantApproval } from '@/contracts/host-v3';
import {
  APPROVAL_NOTICE_BODY,
  APPROVAL_NOTICE_PREFIX,
  ASSISTANT_APPROVAL_CATEGORY,
  ASSISTANT_APPROVE_ACTION,
  ASSISTANT_DENY_ACTION,
  assistantApprovalNotice,
  createAssistantApprovalNoticePump,
  parseAssistantApproval,
} from './assistant-approval-notice';

const HASH = 'a'.repeat(64);
const approval = (over: Partial<AssistantApproval> = {}): AssistantApproval => ({
  id: 'ap_1', assistantId: 'a_1', subjectKind: 'routine', subjectId: 'r_1', action: 'Enable the weekly report routine (Mondays 09:00)',
  actionHash: HASH, expectedRevision: 1, expiresAt: 0, state: 'pending', decidedAt: 0, createdAt: 1, ...over,
});

describe('Assistant approval notice', () => {
  it('carries the category and the hash the tap must echo, with a fixed body', () => {
    const notice = assistantApprovalNotice(approval());
    expect(notice.identifier).toBe(APPROVAL_NOTICE_PREFIX + 'ap_1');
    expect(notice.categoryIdentifier).toBe(ASSISTANT_APPROVAL_CATEGORY);
    expect(notice.body).toBe(APPROVAL_NOTICE_BODY);
    expect(notice.data).toMatchObject({ approval: { id: 'ap_1', actionHash: HASH } });
    expect(JSON.stringify(notice)).not.toMatch(/Private|assistant name/i);
  });

  it('never puts the action text anywhere in the notification', () => {
    const notice = assistantApprovalNotice(approval({ action: 'Enable the nightly secrets sweep' }));
    expect(notice.body).toBe(APPROVAL_NOTICE_BODY);
    expect(JSON.stringify(notice)).not.toContain('secrets sweep');
  });

  it('reads Approve and Deny taps, and nothing else', () => {
    const data = assistantApprovalNotice(approval()).data;
    expect(parseAssistantApproval(ASSISTANT_APPROVE_ACTION, data)).toEqual({ approvalId: 'ap_1', actionHash: HASH, approve: true });
    expect(parseAssistantApproval(ASSISTANT_DENY_ACTION, data)).toEqual({ approvalId: 'ap_1', actionHash: HASH, approve: false });
    expect(parseAssistantApproval('expo.modules.notifications.actions.DEFAULT', data)).toBeNull();
    expect(parseAssistantApproval(ASSISTANT_APPROVE_ACTION, null)).toBeNull();
    expect(parseAssistantApproval(ASSISTANT_APPROVE_ACTION, { approval: { id: 'ap_1', actionHash: 'short' } })).toBeNull();
    expect(parseAssistantApproval(ASSISTANT_APPROVE_ACTION, { approval: { id: '', actionHash: HASH } })).toBeNull();
  });
});

describe('Assistant approval notice pump', () => {
  const make = (list: () => AssistantApproval[], over: Record<string, unknown> = {}) => {
    const schedule = vi.fn(async () => {});
    const dismiss = vi.fn(async () => {});
    const pump = createAssistantApprovalNoticePump({
      approvals: async () => list(), schedule, dismiss, now: () => 1_000, isCurrent: () => true, ...over,
    });
    return { pump, schedule, dismiss };
  };

  it('posts each pending card once and withdraws it when it is decided elsewhere', async () => {
    let state = 'pending';
    const { pump, schedule, dismiss } = make(() => [approval({ state })]);
    await pump.poll();
    await pump.poll();
    expect(schedule).toHaveBeenCalledTimes(1);
    state = 'approved';
    await pump.poll();
    expect(dismiss).toHaveBeenCalledWith(APPROVAL_NOTICE_PREFIX + 'ap_1');
    await pump.poll();
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it('skips expired cards and withdraws one that expires while posted', async () => {
    let expires = 5_000;
    let clock = 1_000;
    const { pump, schedule, dismiss } = make(() => [approval({ expiresAt: expires })], { now: () => clock });
    await pump.poll();
    expect(schedule).toHaveBeenCalledTimes(1);
    clock = 6_000;
    await pump.poll();
    expect(dismiss).toHaveBeenCalledTimes(1);
    expires = 1;
    await pump.poll();
    expect(schedule).toHaveBeenCalledTimes(1);
  });

  it('defers during quiet hours and posts at the next poll', async () => {
    let quiet = true;
    const { pump, schedule } = make(() => [approval()], { mayNotify: async () => !quiet });
    await pump.poll();
    expect(schedule).not.toHaveBeenCalled();
    quiet = false;
    await pump.poll();
    expect(schedule).toHaveBeenCalledTimes(1);
  });

  it('retries a failed OS schedule and posts again for a changed action', async () => {
    let fail = true;
    let hash = HASH;
    const { pump, schedule } = make(() => [approval({ actionHash: hash })]);
    schedule.mockImplementation(async () => {
      if (fail) throw new Error('denied');
    });
    await pump.poll();
    fail = false;
    await pump.poll();
    expect(schedule).toHaveBeenCalledTimes(2);
    hash = 'b'.repeat(64);
    await pump.poll();
    expect(schedule).toHaveBeenCalledTimes(3);
  });

  it('never posts for an obsolete Host', async () => {
    const { pump, schedule } = make(() => [approval()], { isCurrent: () => false });
    await pump.poll();
    expect(schedule).not.toHaveBeenCalled();
  });
});
