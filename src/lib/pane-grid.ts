// [INPUT]: the Host's `pane` message (the Mac pane's cell size), the platform, and the grid the stream was last opened at.
// [OUTPUT]: adoptPaneGrid → whether the terminal view pins its grid to the pane's, and whether the stream must restart at it.
// [POS]: Pure decision for the terminal page. Herdr's observer is only a top-left window onto the Mac pane's screen
//        (no reflow, no cursor follow), so a phone whose grid differs from the pane's shows a cropped screen. Where the
//        native view can pin its grid and pan over it (Android's patched expo-libghostty `fixedGrid`) the phone mirrors
//        the pane; elsewhere it keeps fitting its own view.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { clampGrid, type TerminalGrid } from '@/lib/terminal-protocol-v3';

export interface PaneGridDecision {
  /** The grid to pin the view to; null keeps the view fitting itself. */
  fixed: TerminalGrid | null;
  /** The running stream is not at that grid: restart it there. */
  resize: boolean;
}

export function adoptPaneGrid(platform: string, opened: TerminalGrid | null, pane: TerminalGrid): PaneGridDecision {
  if (platform !== 'android') return { fixed: null, resize: false };
  const fixed = clampGrid(pane);
  return { fixed, resize: opened === null || opened.cols !== fixed.cols || opened.rows !== fixed.rows };
}
