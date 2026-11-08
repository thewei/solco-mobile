// [INPUT]: visibility, a close handler and menu items (label, optional detail, check mark, danger flag, press handler).
// [OUTPUT]: Menu (the 250 dp dropdown card anchored under the app bar's right edge, over a transparent backdrop),
//           MenuItem (a 48 dp row), MenuHeading (a muted caption over a group) and MenuRule (the hairline between groups).
// [POS]: The one popover of the redesign (designs/mobile-t3-redesign `.menu`, Material 3 dropdown): Chat's ⋮, the Chats
//        filter and its Host / Workspace submenus. A plain RN Modal: a few short rows need no native menu library.
//        Tapping outside or the system Back closes it. Sheets (bottom, full width) are OptionSheet.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { Modal, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from 'tamagui';

import { Icon, type Glyph } from '@/components/icon';
import { IconCheck } from '@/theme/glyphs';
import { colors, metrics, radii, type as typeScale } from '@/theme/tokens';

/** The menu hangs from the app bar's lower edge (the design's `top: 87px` = 24 status + 63 bar), 8 dp in from the right edge. */
const BAR_OFFSET = metrics.appBar.height + metrics.appBar.paddingBottom;

export function Menu({ visible, onClose, children }: { visible: boolean; onClose: () => void; children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Close menu">
        <View
          accessibilityRole="menu"
          // Taps on the card must not fall through to the backdrop that closes it.
          onStartShouldSetResponder={() => true}
          style={{
            position: 'absolute',
            top: insets.top + BAR_OFFSET,
            right: 8,
            width: metrics.menu.width,
            maxWidth: '96%',
            paddingVertical: 8,
            borderRadius: radii.menu,
            backgroundColor: colors.menu,
            shadowColor: '#000000',
            shadowOpacity: 0.6,
            shadowRadius: 10,
            shadowOffset: { width: 0, height: 2 },
            elevation: 8,
          }}>
          <ScrollView bounces={false} style={{ maxHeight: height - insets.top - BAR_OFFSET - 24 }}>{children}</ScrollView>
        </View>
      </Pressable>
    </Modal>
  );
}

export function MenuItem({
  label,
  detail,
  leading,
  trailing,
  checked,
  danger = false,
  muted = false,
  onPress,
}: {
  label: string;
  /** The muted word on the right (a count: `3 files`). */
  detail?: string;
  /** A glyph before the label (the back arrow of a submenu's header row). */
  leading?: Glyph;
  /** A glyph after the label (the chevron of a row that opens a submenu). */
  trailing?: Glyph;
  /** Radio-style rows: true draws the check, false keeps its room, undefined draws nothing. */
  checked?: boolean;
  danger?: boolean;
  /** The submenu's back row: smaller, muted. */
  muted?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole={checked === undefined ? 'menuitem' : 'radio'}
      accessibilityLabel={label}
      accessibilityState={checked === undefined ? undefined : { checked }}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        height: metrics.menu.row,
        paddingHorizontal: 16,
        backgroundColor: pressed ? colors.rowPressed : 'transparent',
      })}>
      {leading ? <Icon as={leading} size="md" tone="muted" /> : null}
      <Text
        color={danger ? colors.danger : muted ? colors.textMuted : colors.text}
        fontSize={muted ? typeScale.label.fontSize : typeScale.body.fontSize}
        lineHeight={typeScale.body.lineHeight}
        flex={leading ? 1 : undefined}
        flexShrink={1}
        marginLeft={leading ? 4 : 0}
        numberOfLines={1}>
        {label}
      </Text>
      {detail ? <Text color={colors.textMuted} fontSize={typeScale.label.fontSize} lineHeight={typeScale.label.lineHeight}>{detail}</Text> : null}
      {trailing ? <Icon as={trailing} size="md" tone="muted" /> : null}
      {checked ? <Icon as={IconCheck} size="md" tone="accent" /> : checked === false ? <View style={{ width: 20 }} /> : null}
    </Pressable>
  );
}

export function MenuRule() {
  return <View style={{ height: 1, marginVertical: 8, backgroundColor: colors.border }} />;
}

/** A muted caption over a group of rows (the Host submenu's COMPUTERS / DEVICES). */
export function MenuHeading({ children }: { children: string }) {
  return (
    <Text accessibilityRole="header" color={colors.textMuted} fontSize={typeScale.caption.fontSize} lineHeight={typeScale.caption.lineHeight} fontWeight="500" paddingHorizontal={16} paddingTop={8} paddingBottom={4}>
      {children}
    </Text>
  );
}
