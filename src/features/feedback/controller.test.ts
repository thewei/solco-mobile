import { describe, expect, it, vi } from 'vitest';

import type { FeedbackSnapshot } from '@/contracts/host-v3';
import { HostV3Error } from '@/lib/host-client-v3';

import { createFeedbackController, feedbackFailureText } from './controller';

const snapshot: FeedbackSnapshot = { online: true, threads: [], waiting: 0, selected: '' };

function make(landing?: { thread: string; ask: string }) {
  const ops = {
    snapshot: vi.fn(async (_thread: string, _query: string) => snapshot),
    answer: vi.fn(async () => {}),
    end: vi.fn(async () => {}),
  };
  const manage = {
    deleteThreads: vi.fn(async (ids: string[]) => ids.length),
    cleanup: vi.fn(async () => 3),
    setRetention: vi.fn(async () => {}),
  };
  return {
    ops,
    manage,
    controller: createFeedbackController(ops, () => 'dark', landing),
    managed: createFeedbackController({ ...ops, manage }, () => 'dark', landing),
  };
}

describe('feedback controller', () => {
  it('answers Snapshot with the Host snapshot plus theme and no Git hand-off', async () => {
    const { ops, controller } = make();
    expect(await controller.call('feedback.Snapshot', ['t_1'])).toEqual({ ...snapshot, theme: 'dark', canOpenGit: false, canManage: false });
    expect(ops.snapshot).toHaveBeenCalledWith('t_1', '');
    await controller.call('feedback.Snapshot', ['', '  db  ']);
    expect(ops.snapshot).toHaveBeenLastCalledWith('', 'db');
  });

  it('hands the landing out once, reading its thread, and keeps it until a snapshot arrives', async () => {
    const { ops, controller } = make({ thread: 't_9', ask: 'a_9' });
    ops.snapshot.mockRejectedValueOnce(new Error('offline'));
    await expect(controller.call('feedback.Snapshot', [''])).rejects.toThrow('offline');
    const first = (await controller.call('feedback.Snapshot', [''])) as { focus?: unknown };
    expect(ops.snapshot).toHaveBeenLastCalledWith('t_9', '');
    expect(first.focus).toEqual({ thread: 't_9', ask: 'a_9' });
    const second = (await controller.call('feedback.Snapshot', ['t_9'])) as { focus?: unknown };
    expect(second.focus).toBeUndefined();
    expect(ops.snapshot).toHaveBeenLastCalledWith('t_9', '');
  });

  it('forwards an answer with its attachments only when there are some, and ends an Ask', async () => {
    const { ops, controller } = make();
    await controller.call('feedback.Answer', ['a_1', { q1: { selected: ['x'] } }, []]);
    expect(ops.answer).toHaveBeenLastCalledWith('a_1', { answers: { q1: { selected: ['x'] } } });
    const image = { mimeType: 'image/png', dataBase64: 'AAAA' };
    await controller.call('feedback.Answer', ['a_1', { q1: { selected: [] } }, [image]]);
    expect(ops.answer).toHaveBeenLastCalledWith('a_1', { answers: { q1: { selected: [] } }, attachments: [image] });
    await controller.call('feedback.End', ['a_2']);
    expect(ops.end).toHaveBeenCalledWith('a_2');
  });

  it('manages the inbox only when the Host offers it, and checks every argument first', async () => {
    const { controller, managed, manage } = make();
    await expect(controller.call('feedback.DeleteThreads', [['t_1']])).rejects.toThrow('does not manage');
    expect(((await managed.call('feedback.Snapshot', [''])) as { canManage: boolean }).canManage).toBe(true);
    expect(await managed.call('feedback.DeleteThreads', [['t_1', 't_2']])).toBe(2);
    expect(await managed.call('feedback.Cleanup', [30, true])).toBe(3);
    expect(manage.cleanup).toHaveBeenLastCalledWith(30, true);
    await managed.call('feedback.SetRetention', [90]);
    expect(manage.setRetention).toHaveBeenCalledWith(90);
    await expect(managed.call('feedback.DeleteThreads', [[]])).rejects.toThrow('Bad request.');
    await expect(managed.call('feedback.Cleanup', [0, false])).rejects.toThrow('Bad request.');
    await expect(managed.call('feedback.SetRetention', ['x'])).rejects.toThrow('Bad request.');
  });

  it('refuses a malformed call before the Host, and what a phone cannot do', async () => {
    const { ops, controller } = make();
    await expect(controller.call('feedback.Answer', [7, {}, []])).rejects.toThrow('Bad request.');
    await expect(controller.call('feedback.End', [])).rejects.toThrow('Bad request.');
    await expect(controller.call('feedback.OpenProject', ['t_1', 'git'])).rejects.toThrow('Open the project on the Mac.');
    await expect(controller.call('chat.Snapshot', [])).rejects.toThrow('not available on the phone');
    expect(ops.answer).not.toHaveBeenCalled();
    expect(ops.end).not.toHaveBeenCalled();
  });

  it('words a refused write the way the page shows it', async () => {
    const { ops, controller } = make();
    ops.end.mockRejectedValueOnce(new HostV3Error('http', 'conflict', { status: 409, code: 'feedback_final' }));
    await expect(controller.call('feedback.End', ['a_0'])).rejects.toThrow('That question is already closed.');
    expect(feedbackFailureText(new HostV3Error('http', 'x', { status: 503, code: 'feedback_offline' }))).toContain('not running on the Mac');
    expect(feedbackFailureText(new Error('boom'))).toBe('boom');
    expect(feedbackFailureText('weird')).toBe('Something went wrong.');
  });
});
