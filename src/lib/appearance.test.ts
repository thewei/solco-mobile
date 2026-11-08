import { describe, expect, it } from 'vitest';

import { DEFAULT_APPEARANCE, parseAppearance, resolveScheme, serializeAppearance } from './appearance';

describe('appearance codec', () => {
  it('round-trips each choice', () => {
    for (const a of ['system', 'light', 'dark'] as const) expect(parseAppearance(serializeAppearance(a))).toBe(a);
  });

  it('reads anything unreadable as System', () => {
    for (const raw of [null, undefined, '', 'nope', '{}', '{"appearance":"sepia"}', '[]', '{"appearance":3}']) {
      expect(parseAppearance(raw)).toBe(DEFAULT_APPEARANCE);
    }
  });
});

describe('resolveScheme', () => {
  it('a manual choice wins over the system', () => {
    expect(resolveScheme('light', 'dark')).toBe('light');
    expect(resolveScheme('dark', 'light')).toBe('dark');
  });

  it('System follows the phone; an unknown phone scheme draws dark', () => {
    expect(resolveScheme('system', 'light')).toBe('light');
    expect(resolveScheme('system', 'dark')).toBe('dark');
    expect(resolveScheme('system', null)).toBe('dark');
    expect(resolveScheme('system', undefined)).toBe('dark');
  });
});
