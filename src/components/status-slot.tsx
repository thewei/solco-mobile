// [INPUT]: a Herdr status word for an agent, pane, tab or workspace.
// [OUTPUT]: the one 16pt status slot: working = spinner, idle/done = hollow ring, anything else
//           known = solid dot, nothing known = empty slot (the slot keeps its width).
// [POS]: Single status indicator for every row (same rule as the desktop `status_indicator.go`);
//        nobody paints a private dot or spinner. A blocked (needs-you) dot breathes a soft ring. A status that
//        changes while the row is on screen cross-fades (working → idle is a hand-over, not a cut); the first
//        paint of a row never animates.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { useEffect, useRef } from 'react';
import { ActivityIndicator, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { PulseRing } from '@/components/motion';
import { colors, motion, statusColors } from '@/theme/tokens';

const SLOT = 16;

export function StatusSlot({ status }: { status?: string | null }) {
  const known = status && status !== 'unknown' ? status : null;
  const tone = known ? (statusColors[known]?.color ?? colors.textMuted) : null;
  // Rows mount by the dozen: only a change after mount animates.
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
  }, []);
  const animate = mounted.current;
  return (
    <View style={{ width: SLOT, height: SLOT }}>
      {known || tone ? (
        <Animated.View
          key={known}
          entering={animate ? FadeIn.duration(motion.enterMs) : undefined}
          exiting={FadeOut.duration(motion.exitMs)}
          style={{ position: 'absolute', top: 0, left: 0, width: SLOT, height: SLOT, alignItems: 'center', justifyContent: 'center' }}>
          {known === 'working' ? (
            <ActivityIndicator size="small" color={colors.accent} style={{ transform: [{ scale: 0.6 }] }} />
          ) : known === 'idle' || known === 'done' ? (
            <View style={{ width: 9, height: 9, borderRadius: 5, borderWidth: 1.5, borderColor: tone ?? colors.textMuted }} />
          ) : tone ? (
            <>
              {known === 'blocked' ? <PulseRing size={9} color={tone} /> : null}
              <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: tone }} />
            </>
          ) : null}
        </Animated.View>
      ) : null}
    </View>
  );
}

/** A running service: the same 16pt slot, drawn as a rounded square — shape says the kind (service), colour the urgency. */
export function ServiceSlot() {
  return (
    <View style={{ width: SLOT, height: SLOT, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: colors.success }} />
    </View>
  );
}
