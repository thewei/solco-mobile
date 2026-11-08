// [INPUT]: the Tabs navigator state (expo-router), the route names the Host's capabilities hide, and the Chats badge.
// [OUTPUT]: BottomNav — the four-tab bottom bar (Chats · Sessions · Usage · Settings): an 80 dp bar whose active tab
//           shows a 56x32 pill and the filled glyph where Tabler has one; Chats carries the needs-you count.
// [POS]: The Home `tabBar` (designs/mobile-t3-redesign `.bnav`, Material 3 navigation bar). A tab whose capability the Host
//        does not advertise is not drawn at all. Expo Router's Tabs owns routing and the tab-press events.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import type { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from 'tamagui';

import { fillKey } from '@/components/fill-key';
import { Icon, type Glyph } from '@/components/icon';
import { IconChartBar, IconHistory, IconMessage, IconMessageFilled, IconSettings, IconSettingsFilled } from '@/theme/glyphs';
import { colors, metrics, type as typeScale } from '@/theme/tokens';

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

const TABS: Record<string, { label: string; glyph: Glyph; filled?: Glyph }> = {
  index: { label: 'Chats', glyph: IconMessage, filled: IconMessageFilled },
  sessions: { label: 'Sessions', glyph: IconHistory },
  quota: { label: 'Usage', glyph: IconChartBar },
  settings: { label: 'Settings', glyph: IconSettings, filled: IconSettingsFilled },
};

export function BottomNav({ state, navigation, hidden, badge = 0 }: TabBarProps & { hidden: readonly string[]; badge?: number }) {
  const insets = useSafeAreaInsets();
  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: 'row',
        height: metrics.nav.height + insets.bottom,
        paddingTop: 12,
        paddingHorizontal: 8,
        paddingBottom: 16 + insets.bottom,
        backgroundColor: colors.nav,
      }}>
      {state.routes.map((route, index) => {
        const tab = TABS[route.name];
        if (!tab || hidden.includes(route.name)) return null;
        const focused = state.index === index;
        const onPress = () => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
        };
        return (
          <Pressable key={route.key} accessibilityRole="tab" accessibilityLabel={tab.label} accessibilityState={{ selected: focused }} onPress={onPress} style={{ flex: 1, alignItems: 'center', gap: 4 }}>
            <View key={fillKey(focused)} style={{ width: metrics.nav.pill.width, height: metrics.nav.pill.height, borderRadius: metrics.nav.pill.height / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: focused ? colors.navIndicator : 'transparent' }}>
              <Icon as={focused && tab.filled ? tab.filled : tab.glyph} size="lg" tone="text" />
              {route.name === 'index' && badge > 0 ? <Badge count={badge} /> : null}
            </View>
            <Text color={colors.text} fontSize={typeScale.caption.fontSize} lineHeight={typeScale.caption.lineHeight} fontWeight="500">{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Badge({ count }: { count: number }) {
  return (
    <View style={{ position: 'absolute', top: 0, right: 9, minWidth: 16, height: 16, paddingHorizontal: 4, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.attention }}>
      <Text color={colors.canvas} fontSize={typeScale.micro.fontSize} lineHeight={16} fontWeight="700">{count}</Text>
    </View>
  );
}
