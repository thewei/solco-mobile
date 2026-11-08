// [INPUT]: a label, a glyph, a press handler and whether the list under it is scrolling away from the top.
// [OUTPUT]: Fab (a Material 3 extended floating action button) and useFabCollapse (the scroll handler that folds it into
//           a round button while the list moves down and brings the label back on the way up).
// [POS]: Chats' "New chat" (designs/mobile-t3-redesign `.fab`): 56 dp tall, 16 dp corners, 16 dp from the card's corner,
//        blue. Pinned to the page card, so it sits above the bottom bar; the list under it keeps 96 dp of tail.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import Animated, { Easing, interpolate, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Text } from 'tamagui';

import { Icon, type Glyph } from '@/components/icon';
import { colors, metrics, radii, type as typeScale } from '@/theme/tokens';

const FOLD_AFTER = 24;

export function Fab({ label, icon, collapsed = false, onPress }: { label: string; icon: Glyph; collapsed?: boolean; onPress: () => void }) {
  const fold = useSharedValue(collapsed ? 1 : 0);
  useEffect(() => {
    fold.set(withTiming(collapsed ? 1 : 0, { duration: 200, easing: Easing.out(Easing.cubic) }));
  }, [collapsed, fold]);
  const box = useAnimatedStyle(() => ({ paddingRight: interpolate(fold.get(), [0, 1], [20, 16]) }));
  const word = useAnimatedStyle(() => ({
    maxWidth: interpolate(fold.get(), [0, 1], [120, 0]),
    marginLeft: interpolate(fold.get(), [0, 1], [12, 0]),
    opacity: interpolate(fold.get(), [0, 0.6, 1], [1, 0, 0]),
  }));
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({ position: 'absolute', right: metrics.fab.right, bottom: metrics.fab.bottom, zIndex: 5, opacity: pressed ? 0.92 : 1 })}>
      <Animated.View
        style={[
          {
            height: metrics.fab.height,
            minWidth: metrics.fab.height,
            paddingLeft: 16,
            borderRadius: radii.control,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.accent,
            shadowColor: '#000000',
            shadowOpacity: 0.2,
            shadowRadius: 8,
            shadowOffset: { width: 0, height: 3 },
            elevation: 6,
          },
          box,
        ]}>
        <Icon as={icon} size="lg" tone="onAccent" />
        <Animated.View style={[{ overflow: 'hidden' }, word]}>
          <Text color={colors.onAccent} fontSize={typeScale.label.fontSize} lineHeight={typeScale.label.lineHeight} fontWeight="500" numberOfLines={1}>{label}</Text>
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
}

/** Folds the FAB once the list is past the top and moving down; any upward move (or the top) opens it again. */
export function useFabCollapse() {
  const [collapsed, setCollapsed] = useState(false);
  const last = useRef(0);
  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = event.nativeEvent.contentOffset.y;
    const delta = y - last.current;
    last.current = y;
    if (y <= FOLD_AFTER) setCollapsed(false);
    else if (delta > 2) setCollapsed(true);
    else if (delta < -2) setCollapsed(false);
  }, []);
  return { collapsed, onScroll };
}
