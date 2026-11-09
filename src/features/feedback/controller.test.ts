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
  const pick = vi.fn(async (_thread: string, _kind: 'files' | 'skills', _query: string) => [{ kind: 'skill' as const, name: 'think' }]);
  const manage = {
    deleteThreads: vi.fn(async (ids: string[]) => ids.length),
    cleanup: vi.fn(async () => 3),
    setRetention: vi.fn(async () => {}),
  };
  return {
    ops,
    manage,
    controller: createFeedbackController(ops, () => 'dark', landing),
    managed: createFeedbackController({ ...ops, manage, pick }, () => 'dark', landing),
    pick,
  };
}

describe('feedback controller', () => {
  it('answers Thumbnails from the Host, and with none (older Host, failed read) answers no tiles instead of an error', async () => {
    const { ops, controller } = make();
    const tiles = [{ mimeType: 'image/jpeg', dataBase64: 'AQID', name: 'a.png' }];
    const thumbnails = vi.fn(async (_askId: string) => tiles);
    const served = createFeedbackController({ ...ops, thumbnails }, () => 'dark');
    expect(await served.call('feedback.Thumbnails', ['a_1'])).toEqual(tiles);
    expect(thumbnails).toHaveBeenCalledWith('a_1');
    thumbnails.mockRejectedValueOnce(new HostV3Error('http', 'not found', { status: 404, code: 'not_found' }));
    expect(await served.call('feedback.Thumbnails', ['a_1'])).toEqual([]);
    expect(await controller.call('feedback.Thumbnails', ['a_1'])).toEqual([]);
  });

  it('answers Snapshot with the Host snapshot plus theme and no Git hand-off', async () => {
    const { ops, controller } = make();
    expect(await controller.call('feedback.Snapshot', ['t_1'])).toEqual({ ...snapshot, theme: 'dark', canOpenGit: false, canManage: false, canPick: false });
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

  it('carries the picked files and Skills with an answer, and serves the picker only when the Host does', async () => {
    const { ops, controller, managed, pick } = make();
    await managed.call('feedback.Answer', ['a_1', { q1: { selected: ['x'] } }, [], [{ kind: 'file', name: 'docs/api.md', path: '/Users/me/x' }, { kind: 'skill', name: 'think' }]]);
    expect(ops.answer).toHaveBeenLastCalledWith('a_1', { answers: { q1: { selected: ['x'] } }, context: [{ kind: 'file', name: 'docs/api.md' }, { kind: 'skill', name: 'think' }] });
    expect(await managed.call('feedback.PickContext', ['t_1', 'skills', 'th'])).toEqual([{ kind: 'skill', name: 'think' }]);
    expect(pick).toHaveBeenCalledWith('t_1', 'skills', 'th');
    expect(((await managed.call('feedback.Snapshot', [''])) as { canPick: boolean }).canPick).toBe(true);
    await expect(controller.call('feedback.PickContext', ['t_1', 'files', ''])).rejects.toThrow('does not offer');
    await expect(managed.call('feedback.PickContext', ['t_1', 'secrets', ''])).rejects.toThrow('Bad request.');
    await expect(controller.call('feedback.Answer', ['a_1', {}, [], [{ kind: 'url', name: 'https://x' }]])).rejects.toThrow('Bad request.');
    await controller.call('feedback.Answer', ['a_1', { q1: { selected: ['x'] } }, [], [{ kind: 'file', name: 'docs/api.md', path: '/Users/me/x' }]]);
    expect(ops.answer).toHaveBeenLastCalledWith('a_1', { answers: { q1: { selected: ['x'] } }, context: [{ kind: 'file', name: 'docs/api.md' }] });
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
  it('serves the saved copy as offline when the Mac cannot be reached, and a stated refusal as itself', async () => {
    const { ops } = make();
    const store = { load: vi.fn(async () => null), save: vi.fn(), caps: { manage: false, context: false }, now: () => 1000 };
    const live = { ...snapshot, threads: [{ id: 't1', project: 'p', title: 'one', lastAt: 2, waiting: 0, askCount: 1 }] };
    ops.snapshot.mockResolvedValueOnce(live);
    const controller = createFeedbackController(ops, () => 'dark', { thread: 't1', ask: 'a1' }, store);
    await controller.call('feedback.Snapshot', ['']);
    expect(store.save).toHaveBeenCalledTimes(1);
    ops.snapshot.mockRejectedValueOnce(new Error('Network request failed'));
    const stale = (await controller.call('feedback.Snapshot', [''])) as { online: boolean; stale?: number; threads: unknown[]; focus?: unknown };
    expect(stale).toMatchObject({ online: false, stale: 1000 });
    expect(stale.threads).toHaveLength(1);
    expect(stale.focus).toBeUndefined();
    ops.snapshot.mockRejectedValueOnce(new HostV3Error('http', 'gone', { status: 404, code: 'feedback_not_found' }));
    await expect(controller.call('feedback.Snapshot', [''])).rejects.toThrow('That question is no longer there.');
  });

  it('without any saved copy an unreachable Mac is still an error the page can show', async () => {
    const { ops } = make();
    const store = { load: vi.fn(async () => null), save: vi.fn(), caps: { manage: false, context: false } };
    const controller = createFeedbackController(ops, () => 'dark', undefined, store);
    ops.snapshot.mockRejectedValueOnce(new Error('Network request failed'));
    await expect(controller.call('feedback.Snapshot', [''])).rejects.toThrow('Network request failed');
  });
});
