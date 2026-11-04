import { describe, expect, it, vi } from 'vitest';

const registered = new Map<string, () => () => Promise<void>>();
vi.mock('react-native', () => ({
  Platform: { OS: 'android' },
  AppRegistry: { registerHeadlessTask: (key: string, provider: () => () => Promise<void>) => registered.set(key, provider) },
}));

describe('keep-alive headless task', () => {
  it('registers under the key the native hold starts, and never settles (its lifetime is the timer hold)', async () => {
    const { KEEP_ALIVE_TASK } = await import('@/features/host/keep-alive-task');
    expect(KEEP_ALIVE_TASK).toBe('SolcoKeepAlive'); // SolcoForegroundServiceModule.HOLD_TASK
    const task = registered.get(KEEP_ALIVE_TASK)?.();
    expect(task).toBeTypeOf('function');
    const outcome = await Promise.race([task!().then(() => 'settled'), new Promise((resolve) => setTimeout(() => resolve('pending'), 50))]);
    expect(outcome).toBe('pending');
  });
});
