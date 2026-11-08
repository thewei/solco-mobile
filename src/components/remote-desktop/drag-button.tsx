// [INPUT]: the overlay's size, the saved resting place, a tap handler and an icon.
// [OUTPUT]: DragButton — the floating round button (Touch ⇄ Trackpad) that can be dragged anywhere and, on
//           release, springs to the nearest side edge; the place is reported to `onRest` (saved in prefs).
//           The geometry (rest point, snap) is features/remote-desktop/button-place.ts.
// [POS]: Lives over the Mac's picture, so it must never be a fixture: a finger that moves it more than 6 px is a
//        drag (no tap fires), anything less is a tap. Kept clear of the status/dock bands while dragged.
// [PROTOCOL]: 变更时更新此头部
import { useEffect, useRef } from 'react';
import { Animated, PanResponder, View } from 'react-native';

import { DRAG_BUTTON_SIZE, restPoint, snapPlace, type DragBox } from '@/features/remote-desktop/button-place';
import type { ModeButtonPos } from '@/features/remote-desktop/prefs';
import { colors } from '@/theme/tokens';

const SLOP = 6;

export function DragButton({ box, pos, onRest, onPress, label, dim = false, children }: { box: DragBox; pos: ModeButtonPos; onRest: (pos: ModeButtonPos) => void; onPress: () => void; label: string; dim?: boolean; children: React.ReactNode }) {
  const xy = useRef(new Animated.ValueXY(restPoint(pos, box))).current;
  const live = useRef({ box, onRest, onPress });
  live.current = { box, onRest, onPress };
  const origin = useRef({ x: 0, y: 0 });
  const dragging = useRef(false);

  useEffect(() => {
    if (dragging.current) return;
    Animated.spring(xy, { toValue: restPoint(pos, box), useNativeDriver: false, bounciness: 6 }).start();
  }, [xy, pos, box]);

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        dragging.current = false;
        xy.stopAnimation((v) => (origin.current = v));
      },
      onPanResponderMove: (_, g) => {
        if (!dragging.current && Math.hypot(g.dx, g.dy) > SLOP) dragging.current = true;
        if (dragging.current) xy.setValue({ x: origin.current.x + g.dx, y: origin.current.y + g.dy });
      },
      onPanResponderRelease: (_, g) => {
        if (!dragging.current) return live.current.onPress();
        dragging.current = false;
        live.current.onRest(snapPlace(origin.current.x + g.dx, origin.current.y + g.dy, live.current.box));
      },
      onPanResponderTerminate: (_, g) => {
        if (!dragging.current) return;
        dragging.current = false;
        live.current.onRest(snapPlace(origin.current.x + g.dx, origin.current.y + g.dy, live.current.box));
      },
    }),
  ).current;

  return (
    <Animated.View
      {...responder.panHandlers}
      accessible
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{ position: 'absolute', left: 0, top: 0, opacity: dim ? 0.6 : 1, transform: xy.getTranslateTransform() }}>
      <View style={{ width: DRAG_BUTTON_SIZE, height: DRAG_BUTTON_SIZE, borderRadius: DRAG_BUTTON_SIZE / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.glass, borderWidth: 1, borderColor: colors.border }}>{children}</View>
    </Animated.View>
  );
}
