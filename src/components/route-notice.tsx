// [INPUT]: state/route-notice-store (the one line about a route switch), theme tokens.
// [OUTPUT]: RouteNotice — a non-blocking banner at the top of the screen.
// [POS]: The phone's only place that tells the user the network path changed (Direct ⇄ Relay ⇄ P2P):
//        shown ~3.5 s, tappable to dismiss, never blocks input. Mounted once in the root layout.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from 'tamagui';

import { Tap } from '@/components/tap';
import { useRouteNotice } from '@/state/route-notice-store';
import { colors, motion } from '@/theme/tokens';

const SHOW_MS = 3_500;

export function RouteNotice() {
  const notice = useRouteNotice((state) => state.notice);
  const dismiss = useRouteNotice((state) => state.dismiss);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(dismiss, SHOW_MS);
    return () => clearTimeout(timer);
  }, [notice, dismiss]);

  return notice ? (
    <Animated.View
      key={notice.text}
      entering={FadeInUp.springify().damping(18).stiffness(220)}
      exiting={FadeOutUp.duration(motion.exitMs)}
      style={[styles.banner, { top: insets.top + 8, backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Tap role="alert" accessibilityLabel={notice.text} onPress={dismiss}>
        <Text color={colors.text} fontSize={13}>
          {notice.text}
        </Text>
      </Tap>
    </Animated.View>
  ) : null;
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 1000,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
