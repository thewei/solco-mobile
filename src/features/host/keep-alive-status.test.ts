import { describe, expect, it } from 'vitest';

import { keepAliveStatus } from '@/features/host/keep-alive-status';

describe('keepAliveStatus', () => {
  it('names the three groups with their counts', () => {
    expect(keepAliveStatus({ name: 'MacBook', counts: { needsYou: 10, working: 4, idle: 2 }, reachable: true })).toEqual({
      title: 'Solco · MacBook',
      text: 'Needs you: 10 · Working: 4 · Idle: 2',
    });
  });

  it('keeps zero groups so the line does not jump around', () => {
    expect(keepAliveStatus({ counts: { needsYou: 0, working: 1, idle: 0 }, reachable: true }).text).toBe(
      'Needs you: 0 · Working: 1 · Idle: 0',
    );
  });

  it('says so before the first tree, with no agents, and when the Mac does not answer', () => {
    expect(keepAliveStatus({ counts: null, reachable: true })).toEqual({ title: 'Solco', text: 'Staying connected to your Mac' });
    expect(keepAliveStatus({ counts: { needsYou: 0, working: 0, idle: 0 }, reachable: true }).text).toBe('No agents running');
    expect(keepAliveStatus({ counts: { needsYou: 1, working: 0, idle: 0 }, reachable: false }).text).toContain('Can’t reach');
  });
});
