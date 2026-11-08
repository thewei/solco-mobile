import { beforeEach, describe, expect, it, vi } from 'vitest';

import { hydrateResultsSeen, useResultsStore } from './results-store';

const storage = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }));
vi.mock('@/lib/results-seen-storage', () => ({ loadResultsSeen: storage.load, saveResultsSeen: storage.save }));

beforeEach(() => {
  storage.load.mockReset();
  storage.save.mockReset().mockResolvedValue(undefined);
  useResultsStore.setState({ seen: {} });
});

describe('result-card watermark persistence', () => {
  it('adopts the stored watermarks at start without writing', async () => {
    storage.load.mockResolvedValue({ a_1: 500 });
    await hydrateResultsSeen();
    expect(useResultsStore.getState().seen).toEqual({ a_1: 500 });
    expect(storage.save).not.toHaveBeenCalled();
  });

  it('saves every watermark on a dismissal and never moves one backwards', () => {
    useResultsStore.getState().dismiss('a_1', 900);
    useResultsStore.getState().dismiss('a_1', 400);
    useResultsStore.getState().dismiss('a_2', 100);
    expect(useResultsStore.getState().seen).toEqual({ a_1: 900, a_2: 100 });
    expect(storage.save).toHaveBeenLastCalledWith({ a_1: 900, a_2: 100 });
  });

  it('keeps a dismissal made before the stored watermarks were read (newest wins)', async () => {
    storage.load.mockResolvedValue({ a_1: 500, a_2: 700 });
    const pending = hydrateResultsSeen();
    useResultsStore.getState().dismiss('a_1', 900);
    await pending;
    expect(useResultsStore.getState().seen).toEqual({ a_1: 900, a_2: 700 });
  });
});
