# TUI Virtual Keyboard — design & implementation notes

Status: **designed + implemented + verified on device (2026-09-01)** · owners:
`src/components/tui-keyboard.tsx` (panel), `src/app/tui.tsx` (wiring),
`src/components/native-terminal.tsx` (tap/focus/scroll heuristics).

## Problem

The single-row key strip could only hold ~11 keys. Terminal use needs far more
(Esc/arrows/navigation, F-keys, digits, symbols, letter combos), and two-key
combos (hold Ctrl + tap C) are physically awkward on a phone. Separately, taps
on TUI control buttons summoned the IME because any tap focused the xterm
textarea, while taps on the TUI *input line* must summon it.

## Final design (as shipped)

1. **Keyboard-height panel, four pages, swipe to page.** The nav keyboard icon
   toggles the panel (4 key rows + header, ~250px). Horizontal swipe (>48px)
   pages; the header also shows page pills. All labels are language-neutral:
   `⇧ Ctrl Alt ⌘` latches and `ABC / ⌘ / 123 / #+` page pills (the ⌘ page is an
   icon) — no prose in the UI.
2. **Page 0 is a real phone QWERTY slab** (the default): `qwertyuiop /
   asdfghjkl / ⇧ zxcvbnm ⌫ / 123 / . ⏎` with an inline shift latch and
   backspace, exactly like a native keyboard. Other pages: 「⌘」navigation +
   preset combos `^C ^L ^D ^R ^Z ^U`; 「123」digits + shell symbols; 「#+」
   brackets/punctuation.
3. **Modifier latching**: header chips arm Ctrl/Shift/Alt/⌘ one-shot (armed =
   accent); the next key carries the modifiers. The inline ⇧ is a toggle that
   also feeds the same modifier path — no two-key chords anywhere.
4. **Key transport is the stream WebSocket, in order**: `sendKeyEvent`
   (`{"kind":"key",...}`) and raw text both ride the persistent WS (FIFO).
   This matters: two rapid keystrokes sent as concurrent HTTP POSTs arrived
   **out of order** ("hi" → "ih") in on-device testing. HTTP remains the
   fallback only while the socket reconnects.
5. **Tap policy** (`native-terminal.tsx` touchend):
   - tap in the **bottom two rows** (the Herdr TUI input line) → SGR click and
     NO preventDefault — the native focus path raises the IME with the caret
     in place (verified: `mInputShown=true`);
   - tap elsewhere → `preventDefault()` + `term.blur()` → SGR click only, the
     IME stays down (verified: switcher opens with no keyboard);
   - note: calling `term.focus()` from a preventDefault-ed touchend does NOT
     raise the IME — user activation is lost; that is why the bottom tap keeps
     the native path instead.
6. **Scroll physics**: 9px/line wheel synthesis (1 report ≈ 3 lines on the
   Host), 30ms batched flushes over the WS, and a flick-started momentum loop
   (24ms ticks, ×0.93 decay ≈ 330ms time constant) — content glides after the
   finger lifts. Wheel-down at the conversation tail is a no-op by design.

## Verification record (vivo device)

QWERTY slab renders with pill/latch header; swipe pages to 字母/digits; Shift
latch + `a` produced uppercase `A` in the shell; `hi`/`oh` typed through panel
keys reached the agent in order after the WS FIFO fix; switcher taps raise no
IME; bottom input-line taps raise it (`dumpsys input_method mInputShown`).
