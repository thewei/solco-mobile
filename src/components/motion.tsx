// [INPUT]: children / sizes; the system "reduce motion" setting (Reanimated honours it for layout animations,
//          `useReducedMotion` for the loops here); for ZoomIn, the one-shot rect from `lib/zoom-origin`.
// [OUTPUT]: Reveal (a block that eases in, out and to its new place), Fade, ZoomIn (a screen body that grows out
//           of the surface it was opened from), Chevron (disclosure arrow), ProgressBar, Skeleton (a pulsing
//           placeholder block) and PulseRing (the soft halo of an attention dot).
// [POS]: The shared entrance, loading and attention motion. Durations and offsets come from theme/tokens
//        (`motion`); screens never pick their own. Everything is a no-loop static under reduced motion.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { useEffect, useMemo } from 'react';
import { View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  Extrapolation,
  FadeIn,
  FadeInDown,
  FadeOut,
  interpolate,
  LinearTransition,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { ChevronDown } from 'lucide-react-native';

import { Icon } from '@/components/icon';
import { takeZoomOrigin } from '@/lib/zoom-origin';
import { colors, motion, radii } from '@/theme/tokens';

/** A disclosure chevron that turns half a circle as its section opens. */
export function Chevron({ open }: { open: boolean }) {
  const turn = useSharedValue(open ? 1 : 0);
  useEffect(() => {
    turn.set(withTiming(open ? 1 : 0, { duration: motion.enterMs, easing: Easing.out(Easing.cubic) }));
  }, [open, turn]);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.get() * 180}deg` }] }));
  return (
    <Animated.View style={style}>
      <Icon as={ChevronDown} size="sm" tone="subtle" />
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

/**
 * A screen body that grows out of the surface the user tapped (the Home composer card → the Chat page), read once
 * from `lib/zoom-origin` on mount. Without a hand-off — a deep link, the drawer, Back — it is a soft centered
 * zoom; under reduced motion, a fade. The native stack's own cross-fade carries the rest of the transition.
 */
export function ZoomIn({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const origin = useMemo(() => takeZoomOrigin(), []);
  const reduced = useReducedMotion();
  const progress = useSharedValue(0);
  const { width, height } = useWindowDimensions();
  useEffect(() => {
    progress.set(withSpring(1, { damping: 26, stiffness: 220, mass: 0.9 }));
    return () => cancelAnimation(progress);
  }, [progress]);
  const animated = useAnimatedStyle(() => {
    if (!origin || reduced) return { opacity: progress.get() };
    const scale = origin.width / width;
    return {
      opacity: interpolate(progress.get(), [0, 0.35], [0, 1], Extrapolation.CLAMP),
      borderRadius: interpolate(progress.get(), [0, 1], [radii.lg, 0]),
      transform: [
        { translateX: (origin.x + origin.width / 2 - width / 2) * (1 - progress.get()) },
        { translateY: (origin.y + origin.height / 2 - height / 2) * (1 - progress.get()) },
        { scale: scale + (1 - scale) * progress.get() },
      ],
    };
  }, [origin, reduced, width, height]);
  return (
    <Animated.View style={[{ flex: 1, overflow: 'hidden' }, animated, style]}>
      {children}
    </Animated.View>
  );
}

export function Skeleton({ width = '100%', height = 14, radius = 8 }: { width?: number | `${number}%`; height?: number; radius?: number }) {
  const reduced = useReducedMotion();
  const level = useSharedValue(0.5);
  useEffect(() => {
    if (reduced) return undefined;
    level.set(withRepeat(withTiming(1, { duration: 800, easing: Easing.inOut(Easing.quad) }), -1, true));
    return () => cancelAnimation(level);
  }, [reduced, level]);
  const style = useAnimatedStyle(() => ({ opacity: level.get() }));
  return <Animated.View style={[{ width, height, borderRadius: radius, backgroundColor: colors.surfaceRaised }, style]} />;
}

/** A level bar whose fill eases to its value (and between values when a refresh changes it). */
export function ProgressBar({ pct, color, height = 5 }: { pct: number; color: string; height?: number }) {
  const target = Math.min(100, Math.max(pct, 0));
  const fill = useSharedValue(0);
  useEffect(() => {
    fill.set(withTiming(target, { duration: 500, easing: Easing.out(Easing.cubic) }));
  }, [target, fill]);
  const style = useAnimatedStyle(() => ({ width: `${fill.get()}%` }));
  return (
    <View style={{ height, borderRadius: height, backgroundColor: colors.surfacePressed, overflow: 'hidden' }}>
      <Animated.View style={[{ height, borderRadius: height, backgroundColor: color }, style]} />
    </View>
  );
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
