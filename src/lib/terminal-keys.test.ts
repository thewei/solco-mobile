import { describe, expect, it } from 'vitest';

import { composeTyped, FN_ROW, ignoresMods, isRepeatKey, KEY_ROW, keyInput } from './terminal-keys';

const none = { ctrl: false, alt: false };

describe('terminal key row', () => {
  it('sends the named keys Herdr knows and the xterm sequences it does not', () => {
    expect(keyInput('up', none)).toEqual({ keys: ['up'] });
    expect(keyInput('esc', none)).toEqual({ keys: ['esc'] });
    expect(keyInput('home', none)).toEqual({ text: '\u001b[H' });
    expect(keyInput('end', none)).toEqual({ text: '\u001b[F' });
    expect(keyInput('pgup', none)).toEqual({ text: '\u001b[5~' });
    expect(keyInput('pgdn', none)).toEqual({ text: '\u001b[6~' });
  });

  it('sends F1-F12 as Herdr key names and never spends the sticky modifiers on them', () => {
    expect(keyInput('f10', { ctrl: true, alt: true })).toEqual({ keys: ['f10'] });
    expect(FN_ROW.map((key) => key.id)).toEqual(['fn', ...Array.from({ length: 12 }, (_, i) => `f${i + 1}`)]);
    expect(['f1', 'f12', 'esc', 'home', 'pgdn'].every(ignoresMods)).toBe(true);
    expect(['up', 'a', '|', 'ctrl'].some(ignoresMods)).toBe(false);
    expect(ignoresMods('f13')).toBe(false);
    expect(KEY_ROW.filter((key) => key.kind === 'toggle').map((key) => key.id)).toEqual(['fn']);
  });

  it('applies the sticky modifiers to arrows and symbols, never to Esc/Tab/^C', () => {
    expect(keyInput('left', { ctrl: true, alt: false })).toEqual({ keys: ['ctrl+left'] });
    expect(keyInput('left', { ctrl: false, alt: true })).toEqual({ keys: ['alt+left'] });
    expect(keyInput('left', { ctrl: true, alt: true })).toEqual({ keys: ['ctrl+left'] });
    expect(keyInput('|', none)).toEqual({ text: '|' });
    expect(keyInput('/', { ctrl: false, alt: true })).toEqual({ text: '\u001b/' });
    expect(keyInput('esc', { ctrl: true, alt: true })).toEqual({ keys: ['esc'] });
    expect(keyInput('ctrl+c', { ctrl: true, alt: false })).toEqual({ keys: ['ctrl+c'] });
  });

  it('turns a typed letter into a chord only while a modifier is armed', () => {
    expect(composeTyped('c', none)).toBeNull();
    expect(composeTyped('C', { ctrl: true, alt: false })).toEqual({ keys: ['ctrl+c'] });
    expect(composeTyped('b', { ctrl: false, alt: true })).toEqual({ text: '\u001bb' });
    expect(composeTyped('[', { ctrl: true, alt: false })).toEqual({ text: '\u001b' });
    expect(composeTyped(' ', { ctrl: true, alt: false })).toEqual({ text: '\u0000' });
    expect(composeTyped('d', { ctrl: true, alt: true })).toEqual({ text: '\u001b\u0004' });
  });

  it('never composes an IME phrase or an uncomposable character', () => {
    expect(composeTyped('你好', { ctrl: true, alt: false })).toBeNull();
    expect(composeTyped('1', { ctrl: true, alt: false })).toBeNull();
    expect(composeTyped('é', { ctrl: false, alt: false })).toBeNull();
  });

  it('repeats only arrows and paging, and the row carries the two sticky modifiers once', () => {
    expect(['up', 'down', 'left', 'right', 'pgup', 'pgdn'].every(isRepeatKey)).toBe(true);
    expect(['esc', 'tab', 'home', 'end', '|'].some(isRepeatKey)).toBe(false);
    expect(KEY_ROW.filter((key) => key.kind === 'mod').map((key) => key.id)).toEqual(['ctrl', 'alt']);
    expect(new Set(KEY_ROW.map((key) => key.id)).size).toBe(KEY_ROW.length);
  });
});
