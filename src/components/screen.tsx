// [INPUT]: a title (+ subtitle), an optional back target, round icon actions, and the page body.
// [OUTPUT]: Screen (the chrome band with the app bar, over a rounded content card that holds the body), AppBar and
//           BarButton (the 48 dp round icon target of the bar).
// [POS]: The one page frame of the redesign (designs/mobile-t3-redesign `.appbar` + `.card`): every screen that is not a
//        full-bleed surface (Remote Desktop) draws through it, so the title sits in the bar, never in
//        the content, and the card corner, bar height and button size are defined once. A page that needs its own bar
//        content (the Chats search field) passes `bar`; a sheet that holds a text field (the commit message) passes `overlay`,
//        drawn over the whole screen — bar included — in this window, where the keyboard hooks are reliable (a Modal's
//        are not on edge-to-edge Android). Native-stack headers are off for every route.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text, YStack } from 'tamagui';

import { Icon, type Glyph, type IconTone } from '@/components/icon';
import { IconArrowLeft } from '@/theme/glyphs';
import { colors, metrics, radii, type as typeScale } from '@/theme/tokens';

export interface BarAction {
  icon: Glyph;
  label: string;
  onPress: () => void;
  /** A toggle that is on (the Chats filter): the button keeps the pressed fill. */
  pressed?: boolean;
  tone?: IconTone;
}

/** The 48 dp round icon button of the app bar; its pressed fill is the navigation indicator color. */
export function BarButton({ icon, label, onPress, pressed = false, tone = 'text' }: BarAction) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={pressed ? { selected: true } : undefined}
      onPress={onPress}
      style={({ pressed: down }) => ({
        width: metrics.barButton,
        height: metrics.barButton,
        borderRadius: metrics.barButton / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: down || pressed ? colors.navIndicator : 'transparent',
      })}>
      <Icon as={icon} size="lg" tone={tone} />
    </Pressable>
  );
}

/** Back goes where the stack goes; with nothing to pop (a deep link) it lands on Chats. */
function useBack(back: boolean | (() => void) | undefined) {
  const router = useRouter();
  if (!back) return null;
  if (typeof back === 'function') return back;
  return () => (router.canGoBack() ? router.back() : router.replace('/'));
}

export function AppBar({ title, subtitle, back, actions = [], children }: { title?: string; subtitle?: string; back?: boolean | (() => void); actions?: BarAction[]; children?: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const onBack = useBack(back);
  return (
    <View style={{ backgroundColor: colors.chrome, paddingTop: insets.top }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: metrics.appBar.height + metrics.appBar.paddingBottom, paddingHorizontal: 4, paddingBottom: metrics.appBar.paddingBottom }}>
        {onBack ? <BarButton icon={IconArrowLeft} label="Back" onPress={onBack} /> : null}
        {children ?? (
          <YStack flex={1} minWidth={0} paddingRight={8} paddingLeft={onBack ? 4 : 12}>
            <Text color={colors.text} fontSize={typeScale.appbar.fontSize} lineHeight={typeScale.appbar.lineHeight} fontWeight="400" numberOfLines={1}>{title}</Text>
            {subtitle ? <Text color={colors.textMuted} fontSize={typeScale.small.fontSize} lineHeight={typeScale.small.lineHeight} numberOfLines={1}>{subtitle}</Text> : null}
          </YStack>
        )}
        {actions.map((action) => (
          <BarButton key={action.label} {...action} />
        ))}
      </View>
    </View>
  );
}

/** The chrome band + app bar, then the body on a card whose top corners are rounded (the body owns its own scrolling). */
export function Screen({
  title,
  subtitle,
  back,
  actions,
  bar,
  overlay,
  children,
}: {
  title?: string;
  subtitle?: string;
  back?: boolean | (() => void);
  actions?: BarAction[];
  bar?: React.ReactNode;
  overlay?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <View style={{ flex: 1, backgroundColor: colors.chrome }}>
      <AppBar title={title} subtitle={subtitle} back={back} actions={actions}>
        {bar}
      </AppBar>
      <View style={{ flex: 1, backgroundColor: colors.canvas, borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg, overflow: 'hidden' }}>{children}</View>
      {overlay}
    </View>
  );
}
