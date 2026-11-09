import { describe, expect, it } from 'vitest';

import { feedbackNotice } from '@/features/host/feedback-notice';

const ask = { t: 'feedback', kind: 'ask', threadId: 't_1', askId: 'a_1', waiting: 1 } as const;
const words = { project: 'solco', client: 'Claude Code', preview: 'Which database should the service use?' };

describe('feedbackNotice', () => {
  it('words a new Ask like the desktop notification: project · Agent, then the question first line', () => {
    expect(feedbackNotice({ ...ask, ...words })).toMatchObject({
      kind: 'show',
      request: { identifier: 'solco-feedback/t_1/a_1', title: 'solco · Claude Code', body: 'Which database should the service use?' },
    });
  });

  it('uses what it has: only a project, only an Agent', () => {
    expect(feedbackNotice({ ...ask, project: 'solco', preview: 'Ship it?' })).toMatchObject({ request: { title: 'solco', body: 'Ship it?' } });
    expect(feedbackNotice({ ...ask, client: 'Codex', preview: 'Ship it?' })).toMatchObject({ request: { title: 'Codex' } });
  });

  it('falls back to a plain sentence for a Host that sent no words, counting when several wait', () => {
    expect(feedbackNotice(ask)).toMatchObject({ request: { title: 'An Agent is waiting for your reply', body: 'Open Feedback to answer.' } });
    expect(feedbackNotice({ ...ask, waiting: 3 })).toMatchObject({ request: { body: '3 questions are waiting.' } });
  });

  it('opens Feedback on that thread and Ask when tapped', () => {
    const action = feedbackNotice({ ...ask, ...words });
    if (action.kind !== 'show') throw new Error('expected show');
    expect(JSON.parse(action.request.data.route as string)).toEqual({ pathname: '/feedback', params: { thread: 't_1', ask: 'a_1' } });
  });

  it('dismisses the notification of an Ask that was answered or ended anywhere', () => {
    expect(feedbackNotice({ ...ask, kind: 'resolved', waiting: 0 })).toEqual({ kind: 'dismiss', identifier: 'solco-feedback/t_1/a_1' });
  });
});
