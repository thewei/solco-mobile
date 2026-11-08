// [INPUT]: visibility, a title (+ an optional subtitle) and children (rows, fields, buttons).
// [OUTPUT]: OptionSheet — a Material 3 modal bottom sheet (designs/mobile-t3-redesign `.sheet`): a grabber, a 18 dp title,
//           a muted subtitle and the rows, on a 28 dp-cornered sheet over a dimmed scrim; tapping the scrim or the
//           system back closes it.
// [POS]: Every bottom sheet of the app (Sessions' row actions, the Chats pickers, the New chat folder / agent pickers,
//        Remote Desktop's controls, rename dialogs). A plain RN Modal: these lists are short and need no gestures.
//        Rows inside are ListRow (chevron off) so a sheet reads like the grouped lists.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { Modal, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScrollView, Text } from 'tamagui';

import { colors, radii, type as typeScale } from '@/theme/tokens';

export function OptionSheet({ visible, title, subtitle, onClose, children }: { visible: boolean; title: string; subtitle?: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={{ flex: 1, backgroundColor: colors.scrim }} onPress={onClose} accessibilityLabel="Close" />
      <SafeAreaView edges={['bottom']} style={{ backgroundColor: colors.menu, borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg, maxHeight: '75%', paddingTop: 8, paddingHorizontal: 8 }}>
        <View style={{ alignSelf: 'center', width: 32, height: 4, borderRadius: 2, marginTop: 4, marginBottom: 12, backgroundColor: colors.textMuted, opacity: 0.4 }} />
        <Text accessibilityRole="header" color={colors.text} fontSize={typeScale.title.fontSize} lineHeight={typeScale.title.lineHeight} fontWeight="500" paddingHorizontal={16} paddingBottom={4}>{title}</Text>
        {subtitle ? <Text color={colors.textMuted} fontSize={typeScale.label.fontSize} lineHeight={typeScale.label.lineHeight} paddingHorizontal={16} paddingBottom={12}>{subtitle}</Text> : <View style={{ height: 8 }} />}
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 16 }}>{children}</ScrollView>
      </SafeAreaView>
    </Modal>
  );
}
