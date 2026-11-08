// [INPUT]: raw PTY byte chunks from the Host's observe stream (the handle: write / resize / focus / blur / toLive / getGeometry) plus the same props (onInput / onResize / onScrollBottom).
// [OUTPUT]: Android/iOS VT rendering by libghostty (expo-libghostty: Ghostty's VT parser, Metal on iOS, Canvas on
//           Android) — the same parser family the desktop's MyGo Terminal runs. Typed text and fitted-grid changes go
//           back through the callbacks; the library owns IME, touch selection, scrollback and the key accessory bar.
// [POS]: The phone terminal's renderer (2026-11-07, user-approved: Ghostty is the default and the switch is gone).
//        Android runs expo-libghostty with patches/expo-libghostty.patch: a drag with nothing to scroll locally sends
//        PageUp/PageDown so the program scrolls its own pages. Library gaps are no-ops by design: it has no focus()/blur()/toLive()/
//        resize() and reports no scroll position, so onScrollBottom never fires (the jump-to-latest pill stays hidden —
//        the library draws its own) and the grid is whatever the view's layout fits (onResize drives the Host).
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { TerminalView, type TerminalViewRef } from 'expo-libghostty';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { Platform } from 'react-native';

import { concatBytes } from '@/lib/byte-chunks';
import { base64Encode } from '@/lib/p2p-codec';
import { DEFAULT_THEME, snapshotTheme, TERMINAL_THEMES } from '@/lib/terminal-prefs';

const FONT_SIZE = 10;
// Frames arrive in bursts (a full frame, then deltas); one bridge call per flush.
const FLUSH_MS = 16;
const RESET = new Uint8Array([0x1b, 0x63]); // ESC c

export interface NativeTerminalHandle {
  /** `full`: the bytes replace the whole screen (a stream's first frame) — the view keeps its own scrollback, so it starts clean. */
  write: (data: string | Uint8Array, options?: { full?: boolean }) => void;
  resize: (cols: number, rows: number) => void;
  focus: () => void;
  blur: () => void;
  toLive: () => void;
  getGeometry: () => { cols: number; rows: number } | null;
}

export interface NativeTerminalProps {
  onInput?: (data: string) => void;
  onResize?: (cols: number, rows: number) => void;
  onScrollBottom?: (atBottom: boolean) => void;
  /** Android only (patched library): takeover scrolling — drags/flings arrive as whole lines (positive = older) instead of scrolling or paging. */
  onScrollLines?: ((lines: number) => void) | null;
  /** Android only (patched library), takeover: a plain tap's 0-based cell, forwarded as a left click. */
  onTap?: ((col: number, row: number) => void) | null;
  /** Android only (patched library), takeover: while set, one finger is a mouse (down/drag/up at a 0-based cell) instead of scrolling. */
  onMouse?: ((action: 'down' | 'drag' | 'up', col: number, row: number) => void) | null;
  /** Initial font size (dp); a pinch changes it natively and reports the result through onFontSize (Android). */
  fontSize?: number;
  /** Background / foreground / cursor / selection colors and, optionally, the 16 ANSI colors (else the library's). A plain object (`snapshotTheme`). */
  themeColors?: { background: string; foreground: string; cursorColor: string; selectionBackground: string; palette?: string[] };
  onFontSize?: (size: number) => void;
  /** Android only (patched library): pin the grid to the Mac pane's size; the view pans over it instead of fitting. */
  fixedGrid?: { cols: number; rows: number } | null;
  style?: { width?: number | string; height?: number | string; flex?: number };
}

const MOUSE_ACTIONS = ['down', 'drag', 'up'] as const;


const GhosttyTerminal = forwardRef<NativeTerminalHandle, NativeTerminalProps>(function GhosttyTerminal(
  { onInput, onResize, onScrollLines, onTap, onMouse, onFontSize, fontSize, fixedGrid, themeColors },
  forwardedRef,
) {
  const viewRef = useRef<TerminalViewRef>(null);
  const geometryRef = useRef<{ cols: number; rows: number } | null>(null);
  const pendingRef = useRef<Uint8Array[]>([]);
  const flushRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    flushRef.current = null;
    const batch = pendingRef.current;
    pendingRef.current = [];
    if (batch.length === 0) return;
    // The library queues calls made before its native view registered (see its TerminalView), so no ready gate here.
    viewRef.current?.write(base64Encode(concatBytes(batch))).catch((cause: unknown) => {
      console.log(`[tui-ghostty] write failed: ${String(cause)}`);
    });
  }, []);

  useEffect(
    () => () => {
      if (flushRef.current) clearTimeout(flushRef.current);
    },
    [],
  );

  useImperativeHandle(
    forwardedRef,
    () => ({
      write: (data, options) => {
        // A full frame is the whole screen again (stream restart after a resize/reconnect). Ghostty keeps the old
        // screen and scrollback and would stack the new frame onto them — duplicated rows — so reset first (RIS).
        if (options?.full) pendingRef.current = [RESET];
        pendingRef.current.push(typeof data === 'string' ? new TextEncoder().encode(data) : data);
        flushRef.current ??= setTimeout(flush, FLUSH_MS);
      },
      resize: () => undefined,
      focus: () => undefined,
      blur: () => undefined,
      toLive: () => undefined,
      getGeometry: () => geometryRef.current,
    }),
    [flush],
  );

  const theme = useMemo(() => themeColors ?? snapshotTheme(TERMINAL_THEMES[DEFAULT_THEME]), [themeColors]);

  return (
    <TerminalView
      ref={viewRef}
      style={{ flex: 1, backgroundColor: theme.background }}
      fontSize={fontSize ?? FONT_SIZE}
      accessoryBar={Platform.OS === 'android' ? false : undefined}
      onFontSize={({ nativeEvent }) => onFontSize?.(nativeEvent.size)}
      fixedGrid={Platform.OS === 'android' ? (fixedGrid ?? undefined) : undefined}
      remoteScroll={Platform.OS === 'android' && !!onScrollLines}
      theme={theme}
      onInput={({ nativeEvent }) => onInput?.(nativeEvent.text)}
      onScrollLines={({ nativeEvent }) => onScrollLines?.(nativeEvent.lines)}
      onTap={({ nativeEvent }) => onTap?.(nativeEvent.col, nativeEvent.row)}
      remoteMouse={Platform.OS === 'android' && !!onMouse}
      onMouse={({ nativeEvent }) => onMouse?.(MOUSE_ACTIONS[nativeEvent.action] ?? 'up', nativeEvent.col, nativeEvent.row)}
      onResize={({ nativeEvent }) => {
        geometryRef.current = { cols: nativeEvent.cols, rows: nativeEvent.rows };
        onResize?.(nativeEvent.cols, nativeEvent.rows);
      }}
    />
  );
});

export default GhosttyTerminal;
