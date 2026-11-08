// [INPUT]: children / sizes; the system "reduce motion" setting (Reanimated honours it for layout animations,
//          `useReducedMotion` for the loops here).
// [OUTPUT]: Reveal (a block that eases in, out and to its new place), Fade, Spin (a turning glyph), Chevron (disclosure
//           arrow), Skeleton (a pulsing placeholder block) and PulseRing (the soft halo of an attention dot).
// [POS]: The shared entrance, loading and attention motion. Durations and offsets come from theme/tokens
//        (`motion`); screens never pick their own. Everything is a no-loop static under reduced motion.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { useEffect } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  FadeIn,
  FadeInDown,
  FadeOut,
  interpolateColor,
  LinearTransition,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';


import { Icon } from '@/components/icon';
import { IconChevronDown } from '@/theme/glyphs';
import { colors, motion, radii } from '@/theme/tokens';

/** Turns its child once a second, forever; still under the system "reduce motion" setting (the glyph alone says "working"). */
export function Spin({ children }: { children: React.ReactNode }) {
  const turn = useSharedValue(0);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (reduced) return undefined;
    turn.set(withRepeat(withTiming(1, { duration: 1000, easing: Easing.linear }), -1));
    return () => cancelAnimation(turn);
  }, [reduced, turn]);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.get() * 360}deg` }] }));
  return <Animated.View style={style}>{children}</Animated.View>;
}

/** A disclosure chevron that turns half a circle as its section opens. */
export function Chevron({ open }: { open: boolean }) {
  const turn = useSharedValue(open ? 1 : 0);
  useEffect(() => {
    turn.set(withTiming(open ? 1 : 0, { duration: motion.enterMs, easing: Easing.out(Easing.cubic) }));
  }, [open, turn]);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.get() * 180}deg` }] }));
  return (
    <Animated.View style={style}>
      <Icon as={IconChevronDown} size="sm" tone="subtle" />
    </Animated.View>
  );
}

/**
 * `index` staggers a list's first paint. Only the first screenful animates in (`motion.maxAnimated`): every
 * animated view costs UI-thread layout work, and rows further down are off screen anyway. `layout` (sliding to a
 * new place when siblings change) is opt-in and meant for a handful of blocks, never for every row of a list.
 */
export function Reveal({ children, index = 0, layout = false, style }: { children: React.ReactNode; index?: number; layout?: boolean; style?: StyleProp<ViewStyle> }) {
  if (index >= motion.maxAnimated) return <View style={style}>{children}</View>;
  return (
    <Animated.View
      entering={FadeInDown.duration(motion.enterMs).delay(index * motion.stagger)}
      exiting={FadeOut.duration(motion.exitMs)}
      layout={layout ? LinearTransition.duration(motion.enterMs) : undefined}
      style={style}>
      {children}
    </Animated.View>
  );
}

/** Cross-fade for content that swaps in place (a spinner becoming a list). */
export function Fade({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <Animated.View entering={FadeIn.duration(motion.enterMs)} exiting={FadeOut.duration(motion.exitMs)} style={style}>
      {children}
    </Animated.View>
  );
}

export function Skeleton({ width = '100%', height = 14, radius = radii.block }: { width?: number | `${number}%`; height?: number; radius?: number }) {
  const reduced = useReducedMotion();
  const level = useSharedValue(0);
  useEffect(() => {
    if (reduced) return undefined;
    level.set(withRepeat(withTiming(1, { duration: 650, easing: Easing.inOut(Easing.quad) }), -1, true));
    return () => cancelAnimation(level);
  }, [reduced, level]);
  const style = useAnimatedStyle(() => ({ backgroundColor: interpolateColor(level.get(), [0, 1], [colors.skeleton, colors.skeletonHigh]) }));
  return <Animated.View style={[{ width, height, borderRadius: radius }, style]} />;
}

/** A slow expanding ring behind a dot; `size` is the dot's diameter. */
export function PulseRing({ size, color }: { size: number; color: string }) {
  const reduced = useReducedMotion();
  const phase = useSharedValue(0);
  useEffect(() => {
    if (reduced) return undefined;
    phase.set(withRepeat(withTiming(1, { duration: 1400, easing: Easing.out(Easing.quad) }), -1, false));
    return () => cancelAnimation(phase);
  }, [reduced, phase]);
  const style = useAnimatedStyle(() => ({ opacity: 0.45 * (1 - phase.get()), transform: [{ scale: 1 + phase.get() * 1.2 }] }));
  if (reduced) return null;
  return <Animated.View pointerEvents="none" style={[{ position: 'absolute', width: size, height: size, borderRadius: size, backgroundColor: color }, style]} />;
}
