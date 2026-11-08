import { describe, expect, it } from 'vitest';

import {
  clampFontSize,
  DEFAULT_FONT_SIZE,
  DEFAULT_PREFS,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  parsePrefs,
  serializePrefs,
  TERMINAL_THEMES,
} from './terminal-prefs';

describe('terminal prefs', () => {
  it('round-trips a font size and a theme, clamping the size to the readable range', () => {
    expect(parsePrefs(serializePrefs({ fontSize: 13, theme: 'dracula' }))).toEqual({ fontSize: 13, theme: 'dracula' });
    expect(clampFontSize(2)).toBe(MIN_FONT_SIZE);
    expect(clampFontSize(80)).toBe(MAX_FONT_SIZE);
    expect(parsePrefs('{"fontSize":99}').fontSize).toBe(MAX_FONT_SIZE);
  });

  it('reads a file written before themes existed, and falls back from an unknown theme', () => {
    expect(parsePrefs('{"fontSize":12}')).toEqual({ fontSize: 12, theme: 'solco' });
    expect(parsePrefs('{"fontSize":12,"theme":"nope"}').theme).toBe('solco');
    expect(parsePrefs('{"fontSize":12,"theme":"constructor"}').theme).toBe('solco');
  });

  it('treats anything unreadable as the defaults', () => {
    for (const raw of [null, undefined, '', 'nope', '{}', '{"fontSize":"big"}', '[1]']) {
      expect(parsePrefs(raw)).toEqual(DEFAULT_PREFS);
    }
    expect(DEFAULT_PREFS.fontSize).toBe(DEFAULT_FONT_SIZE);
  });

  it('every theme carries the four colors the library takes', () => {
    for (const theme of Object.values(TERMINAL_THEMES)) {
      expect(theme.background).toMatch(/^#[0-9a-f]{6}$/i);
      expect(theme.foreground).toMatch(/^#[0-9a-f]{6}$/i);
      expect(theme.cursorColor).toMatch(/^#[0-9a-f]{6}$/i);
      expect(theme.selectionBackground).toMatch(/^#[0-9a-f]{6,8}$/i);
    }
  });
});
