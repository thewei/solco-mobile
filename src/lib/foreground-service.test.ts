import { describe, expect, it } from 'vitest';

import { createForegroundService, type NativeForegroundService } from '@/lib/foreground-service';

const status = { title: 'Solco', text: 'Needs you: 1 · Working: 2 · Idle: 3' };

const native = (over: Partial<NativeForegroundService> = {}): NativeForegroundService => ({
  start: () => undefined,
  update: () => true,
  stop: () => true,
  isIgnoringBatteryOptimizations: () => true,
  openIgnoreBatteryOptimizations: () => undefined,
  ...over,
});

describe('createForegroundService', () => {
  it('start swallows a refused foreground service (the Android 12+ from-background rule)', () => {
    const service = createForegroundService(
      native({
        start: () => {
          throw new Error('ForegroundServiceStartNotAllowedException');
        },
      }),
    );
    expect(() => service.start(status)).not.toThrow();
  });

  it('start and update hand the title and status line to the native notification', () => {
    const calls: string[][] = [];
    const service = createForegroundService(
      native({
        start: (title, text) => void calls.push(['start', title, text]),
        update: (title, text) => (calls.push(['update', title, text]), true),
      }),
    );
    service.start(status);
    service.update({ title: 'Solco', text: 'No agents' });
    expect(calls).toEqual([
      ['start', 'Solco', status.text],
      ['update', 'Solco', 'No agents'],
    ]);
  });

  it('update never throws into the render path', () => {
    const service = createForegroundService(
      native({
        update: () => {
          throw new Error('boom');
        },
      }),
    );
    expect(() => service.update(status)).not.toThrow();
  });
});
