import { describe, expect, it } from 'vitest';

import { feedbackNotice } from '@/features/host/feedback-notice';

const ask = { t: 'feedback', kind: 'ask', threadId: 't_1', askId: 'a_1', waiting: 1 } as const;

describe('feedbackNotice', () => {
  it('words a new Ask with a fixed sentence and nothing from the question', () => {
    const action = feedbackNotice(ask);
    expect(action).toMatchObject({ kind: 'show', request: { identifier: 'solco-feedback/t_1/a_1', title: 'An Agent is waiting for your reply', body: 'Open Feedback to answer.' } });
    const text = JSON.stringify(action);
    expect(text).not.toMatch(/project|solco |claude|database/i);
  });

  it('counts when several wait', () => {
    expect(feedbackNotice({ ...ask, waiting: 3 })).toMatchObject({ request: { body: '3 questions are waiting.' } });
  });

  it('opens Feedback on that thread and Ask when tapped', () => {
    const action = feedbackNotice(ask);
    if (action.kind !== 'show') throw new Error('expected show');
    expect(JSON.parse(action.request.data.route as string)).toEqual({ pathname: '/feedback', params: { thread: 't_1', ask: 'a_1' } });
  });

  it('dismisses the notification of an Ask that was answered or ended anywhere', () => {
    expect(feedbackNotice({ ...ask, kind: 'resolved', waiting: 0 })).toEqual({ kind: 'dismiss', identifier: 'solco-feedback/t_1/a_1' });
  });
});
