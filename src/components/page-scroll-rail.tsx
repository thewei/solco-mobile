// [INPUT]: onPage(direction) from the terminal screen.
// [OUTPUT]: PageScrollRail — a thin transparent strip on the terminal's right edge; dragging it sends PgUp (drag down) / PgDn (drag up),
//           or — during a takeover (`onLines`) — scrolls the pane line by line (drag down = older).
// [POS]: Gives the libghostty view (whose touches are native and cannot be intercepted) a way to scroll a full-screen TUI's own pages.
//        Only the strip is captured; the rest of the terminal keeps selection and taps.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { useMemo, useRef } from 'react';
import { PanResponder, View } from 'react-native';

import { pagesFromDrag } from '@/lib/page-keys';
import { colors } from '@/theme/tokens';

const STEP_PX = 72;
const LINE_PX = 18;
const WIDTH = 22;

export function PageScrollRail({ onPage, onLines }: { onPage: (direction: 'up' | 'down') => void; onLines?: (lines: number) => void }) {
  const handler = useRef(onPage);
  handler.current = onPage;
  const lineHandler = useRef(onLines);
  lineHandler.current = onLines;
  const consumed = useRef(0);
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          consumed.current = 0;
        },
        onPanResponderMove: (_, gesture) => {
          const lines = lineHandler.current;
          const next = pagesFromDrag(gesture.dy, consumed.current, lines ? LINE_PX : STEP_PX);
          consumed.current = next.consumed;
          if (lines) {
            if (next.pages !== 0) lines(next.pages);
            return;
          }
          for (let i = 0; i < Math.abs(next.pages); i++) handler.current(next.pages > 0 ? 'up' : 'down');
        },
      }),
    [],
  );
  return (
    <View
      {...responder.panHandlers}
      accessibilityLabel="Drag to page up or down"
      style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: WIDTH, alignItems: 'center', justifyContent: 'center' }}>
      <View pointerEvents="none" style={{ width: 3, height: 44, borderRadius: 2, backgroundColor: colors.borderStrong, opacity: 0.6 }} />
    </View>
  );
}
