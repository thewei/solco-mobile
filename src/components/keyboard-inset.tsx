// [INPUT]: reanimated's useAnimatedKeyboard + the bottom safe-area inset.
// [OUTPUT]: KeyboardInset: a flex:1 wrapper that lifts its children (a composer pinned at the bottom) above the soft keyboard.
//           KeyboardDock: the same lift for an absolutely positioned overlay (fills its parent, rides up by the keyboard height).
// [POS]: The one keyboard-avoidance owner. Edge-to-edge Android never resizes the window, and RN's
//        KeyboardAvoidingView miscounts under a native header, so the composer hid behind the keyboard
//        on a real device (Home and Chat) — screens use this instead of KeyboardAvoidingView.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import type { ReactNode } from 'react';
import Animated, { useAnimatedKeyboard, useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export function KeyboardInset({ children }: { children: ReactNode }) {
  const keyboard = useAnimatedKeyboard();
  const { bottom } = useSafeAreaInsets();
  // The screen's SafeAreaView already pads the bottom inset; the keyboard covers that strip itself.
  const style = useAnimatedStyle(() => ({ paddingBottom: Math.max(0, keyboard.height.value - bottom) }));
  return <Animated.View style={[{ flex: 1 }, style]}>{children}</Animated.View>;
}

/**
 * For an overlay: absolute children are positioned against the parent's border box, which KeyboardInset's padding does
 * not shrink, and an animated `bottom` does not re-lay-out children on Android — so the dock fills its parent and
 * rides up by a transform (always applied natively) equal to the keyboard's height.
 */
export function KeyboardDock({ children }: { children: ReactNode }) {
  const keyboard = useAnimatedKeyboard();
  const { bottom } = useSafeAreaInsets();
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: -Math.max(0, keyboard.height.value - bottom) }] }));
  return (
    <Animated.View pointerEvents="box-none" style={[{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }, style]}>
      {children}
    </Animated.View>
  );
}
