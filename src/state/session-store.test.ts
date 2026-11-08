import { beforeEach, describe, expect, it, vi } from 'vitest';

import { hydrateLaunchPick, resetLaunchPickHydration, useSessionStore } from './session-store';

const storage = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }));
vi.mock('@/lib/launch-pick-storage', () => ({ loadLaunchPick: storage.load, saveLaunchPick: storage.save }));

beforeEach(() => {
  storage.load.mockReset();
  storage.save.mockReset().mockResolvedValue(undefined);
  resetLaunchPickHydration();
  useSessionStore.setState({ launchAgent: null, launchTerminal: false });
});

describe('Home launch pick persistence', () => {
  it('adopts the stored pick at start', async () => {
    storage.load.mockResolvedValue({ agent: 'codex', terminal: true });
    await hydrateLaunchPick();
    expect(useSessionStore.getState()).toMatchObject({ launchAgent: 'codex', launchTerminal: true });
    expect(storage.save).not.toHaveBeenCalled();
  });

  it('saves the whole pick on every change', () => {
    useSessionStore.getState().setLaunchPick({ agent: 'claude' });
    useSessionStore.getState().setLaunchPick({ terminal: true });
    expect(storage.save).toHaveBeenNthCalledWith(1, { agent: 'claude', terminal: false });
    expect(storage.save).toHaveBeenNthCalledWith(2, { agent: 'claude', terminal: true });
  });

  it('keeps a pick made before the stored one was read', async () => {
    storage.load.mockResolvedValue({ agent: 'codex', terminal: false });
    const pending = hydrateLaunchPick();
    useSessionStore.getState().setLaunchPick({ agent: 'claude' });
    await pending;
    expect(useSessionStore.getState().launchAgent).toBe('claude');
  });
});
