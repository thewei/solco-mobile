// [INPUT]: a message a page wants to confirm, and optionally one action on it (Undo).
// [OUTPUT]: useToast() — `{ toast, show }`: render `toast` inside the page's Screen, call `show(text, action?)` to raise it.
// [POS]: The one confirmation voice of the redesign (designs/mobile-t3-redesign `.toast`): a light chip 16 dp from the card's sides
//        and bottom, 26 dp corners, auto-dismissed (1.8 s; 6 s when it carries an action, so Undo can be reached). A new message
//        replaces the old one. A screen reader hears it as a polite live region; the entrance and exit are Reanimated layout
//        animations, which honor the system reduce-motion setting.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { FadeInDown, FadeOut } from 'react-native-reanimated';
import { Text } from 'tamagui';

import { colors, radii, type as typeScale } from '@/theme/tokens';

interface ToastState {
  id: number;
  text: string;
  action?: { label: string; onPress: () => void };
}

const PLAIN_MS = 1800;
const ACTION_MS = 6000;

export function useToast() {
  const [state, setState] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const counter = useRef(0);

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setState(null);
  }, []);

  const show = useCallback(
    (text: string, action?: ToastState['action']) => {
      if (timer.current) clearTimeout(timer.current);
      counter.current += 1;
      setState({ id: counter.current, text, action });
      timer.current = setTimeout(clear, action ? ACTION_MS : PLAIN_MS);
    },
    [clear],
  );

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const toast = state ? (
    <Animated.View key={state.id} entering={FadeInDown.duration(200)} exiting={FadeOut.duration(200)} pointerEvents="box-none" style={{ position: 'absolute', left: 16, right: 16, bottom: 16 }}>
      <View
        accessibilityLiveRegion="polite"
        style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 16, borderRadius: radii.toast, backgroundColor: colors.toast, elevation: 6 }}>
        <Text flex={1} color={colors.onToast} fontSize={typeScale.label.fontSize} lineHeight={typeScale.label.lineHeight} fontWeight="500">{state.text}</Text>
        {state.action ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={state.action.label}
            hitSlop={12}
            onPress={() => {
              const press = state.action?.onPress;
              clear();
              press?.();
            }}>
            <Text color={colors.toastAction} fontSize={typeScale.label.fontSize} lineHeight={typeScale.label.lineHeight} fontWeight="700">{state.action.label}</Text>
          </Pressable>
        ) : null}
      </View>
    </Animated.View>
  ) : null;

  return { toast, show };
}
