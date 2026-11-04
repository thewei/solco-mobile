import { describe, expect, it } from 'vitest';

import { KB_BOTTOM, KB_MAIN, KB_SYMBOLS, KeyComposer, SHORTCUTS } from './keys';
import { createSender, type Outgoing } from './protocol';

function rig() {
  const out: Outgoing[] = [];
  const composer = new KeyComposer(createSender((o) => out.push(o)));
  const keys = () => out.map((o) => (o.message.type === 'key' ? `${o.message.down ? '+' : '-'}${o.message.code}` : o.message.type));
  return { composer, keys, out };
}

describe('KeyComposer', () => {
  it('a plain key is a down and an up', () => {
    const { composer, keys } = rig();
    composer.press('Escape');
    expect(keys()).toEqual(['+Escape', '-Escape']);
  });

  it('a one-shot modifier wraps the next key and is then spent', () => {
    const { composer, keys } = rig();
    composer.cycle('Meta');
    composer.press('KeyC');
    composer.press('KeyV');
    expect(keys()).toEqual(['+MetaLeft', '+KeyC', '-KeyC', '-MetaLeft', '+KeyV', '-KeyV']);
  });

  it('a locked modifier stays until cycled off; order is Meta, Control, Alt, Shift and released in reverse', () => {
    const { composer, keys } = rig();
    composer.cycle('Shift');
    composer.cycle('Shift'); // locked
    composer.cycle('Meta'); // once
    composer.press('KeyZ');
    expect(keys()).toEqual(['+MetaLeft', '+ShiftLeft', '+KeyZ', '-KeyZ', '-ShiftLeft', '-MetaLeft']);
    expect(composer.latch('Meta')).toBe('off');
    expect(composer.latch('Shift')).toBe('locked');
    composer.cycle('Shift');
    expect(composer.latch('Shift')).toBe('off');
  });

  it('shortcuts ignore and keep the latches; modifiers are never left held', () => {
    const { composer, keys, out } = rig();
    composer.cycle('Alt');
    composer.shortcut(SHORTCUTS[0]!); // ⌘C
    expect(keys()).toEqual(['+MetaLeft', '+KeyC', '-KeyC', '-MetaLeft']);
    expect(composer.latch('Alt')).toBe('once');
    const downs = out.filter((o) => o.message.type === 'key' && o.message.down).length;
    const ups = out.filter((o) => o.message.type === 'key' && !o.message.down).length;
    expect(downs).toBe(ups);
  });

  it('notifies subscribers on change', () => {
    const { composer } = rig();
    let n = 0;
    const off = composer.subscribe(() => n++);
    composer.cycle('Control');
    composer.press('KeyC');
    off();
    composer.clear();
    expect(n).toBe(2);
  });
});

describe('on-screen keyboard layout', () => {
  // the codes solco's macOS keymap (platform/macos/keymap.go) knows
  const MAC = new Set(
    'KeyA KeyS KeyD KeyF KeyH KeyG KeyZ KeyX KeyC KeyV KeyB KeyQ KeyW KeyE KeyR KeyY KeyT KeyO KeyU KeyI KeyP KeyL KeyJ KeyK KeyN KeyM Digit0 Digit1 Digit2 Digit3 Digit4 Digit5 Digit6 Digit7 Digit8 Digit9 Equal Minus BracketRight BracketLeft Enter Quote Semicolon Backslash Comma Slash Period Tab Space Backquote Backspace Escape CapsLock F1 F2 F3 F4 F5 F6 F7 F8 F9 F10 F11 F12 Home End PageUp PageDown Delete ArrowLeft ArrowRight ArrowDown ArrowUp'.split(' '),
  );

  it('every cap sends a code the Mac knows (or is a modifier) and every row fills the same width', () => {
    for (const rows of [KB_MAIN, KB_SYMBOLS, [KB_BOTTOM]]) {
      for (const row of rows) for (const k of row) expect(k.mod ? '' : MAC.has(k.code) ? '' : k.code).toBe('');
    }
    const width = (row: readonly { w?: number }[]) => row.reduce((n, k) => n + (k.w ?? 1), 0);
    for (const row of KB_MAIN) expect(width(row)).toBeCloseTo(11.5);
    expect(width(KB_BOTTOM) + 1).toBeCloseTo(11.5); // the page key takes the last unit
  });

  it('together the pages carry the whole ANSI key set a Mac needs', () => {
    const codes = new Set([...KB_MAIN.flat(), ...KB_SYMBOLS.flat(), ...KB_BOTTOM].map((k) => k.code));
    for (const c of ['Escape', 'Tab', 'Backspace', 'Enter', 'Space', 'CapsLock', 'Delete', 'Home', 'End', 'PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backquote', 'Minus', 'Equal', 'BracketLeft', 'BracketRight', 'Backslash', 'Semicolon', 'Quote', 'Comma', 'Period', 'Slash', ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`), ...Array.from({ length: 10 }, (_, i) => `Digit${i}`)]) {
      expect(codes.has(c), c).toBe(true);
    }
  });

  it('has every letter once and every shortcut resolves to a known key', () => {
    const letters = KB_MAIN.flat().filter((k) => /^Key[A-Z]$/.test(k.code)).map((k) => k.code);
    expect(new Set(letters).size).toBe(26);
    for (const s of SHORTCUTS) expect(MAC.has(s.code)).toBe(true);
  });

  it('press returns its chord and repeat replays it after a one-shot latch is spent', () => {
    const { composer, keys } = rig();
    composer.cycle('Meta');
    const mods = composer.press('Backspace');
    composer.repeat(mods, 'Backspace');
    expect(mods).toEqual(['Meta']);
    expect(keys()).toEqual(['+MetaLeft', '+Backspace', '-Backspace', '-MetaLeft', '+MetaLeft', '+Backspace', '-Backspace', '-MetaLeft']);
  });
});
