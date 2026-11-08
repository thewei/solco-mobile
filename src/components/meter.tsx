// [INPUT]: the share used (0–100), its level (ok / warn / bad) and, optionally, where an even rate would be by now.
// [OUTPUT]: Meter — a 28 dp bar whose fill eases to its value, tinted by level, with a 2 dp tick at the even-rate position.
// [POS]: The usage card's gauge (designs/mobile-t3-redesign `.meter`): neutral gray while the window is under the warning level,
//        amber from 80 %, red from 95 % (the model's own thresholds). It is a progress bar for a screen reader ("82% used"); the
//        tick is decoration, the card's pace line says the same in words.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import type { QuotaLevel } from '@/features/host/quota-model';
import { colors, radii, themed } from '@/theme/tokens';

const FILL: Record<QuotaLevel, string> = themed(() => ({ ok: colors.meterFill, warn: colors.attention, bad: colors.danger }));

export function Meter({ usedPct, level, tickPct }: { usedPct: number; level: QuotaLevel; tickPct?: number | null }) {
  const target = Math.min(100, Math.max(usedPct, 0));
  const fill = useSharedValue(0);
  useEffect(() => {
    fill.set(withTiming(target, { duration: 500, easing: Easing.out(Easing.cubic) }));
  }, [target, fill]);
  const style = useAnimatedStyle(() => ({ width: `${fill.get()}%` }));
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={`${Math.round(target)}% used`}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(target) }}
      style={{ height: 28, marginTop: 12, borderRadius: radii.block, overflow: 'hidden', backgroundColor: colors.meterTrack }}>
      <Animated.View style={[{ position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: FILL[level] }, style]} />
      {tickPct != null ? <View style={{ position: 'absolute', top: 0, bottom: 0, left: `${Math.min(tickPct, 100)}%`, width: 2, backgroundColor: colors.text }} /> : null}
    </View>
  );
}
