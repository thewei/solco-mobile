// [INPUT]: visibility, a title and children (rows).
// [OUTPUT]: OptionSheet — a bottom sheet over a dimmed backdrop; tapping the backdrop or the system back closes it.
// [POS]: Home composer's pickers (folder, agent). A plain RN Modal: these lists are short and need no gestures.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { Modal, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScrollView, Text, YStack } from 'tamagui';

import { colors, radii } from '@/theme/tokens';

export function OptionSheet({ visible, title, onClose, children }: { visible: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }} onPress={onClose} accessibilityLabel="Close" />
      <SafeAreaView edges={['bottom']} style={{ backgroundColor: colors.surface, borderTopLeftRadius: radii.lg + 6, borderTopRightRadius: radii.lg + 6, maxHeight: '75%' }}>
        <YStack paddingHorizontal="$4" paddingTop="$3" paddingBottom="$2">
          <Text color={colors.textMuted} fontSize={12} fontWeight="700" letterSpacing={0.6}>{title.toUpperCase()}</Text>
        </YStack>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 12 }}>{children}</ScrollView>
      </SafeAreaView>
    </Modal>
  );
}
