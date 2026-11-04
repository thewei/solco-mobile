// [INPUT]: menu items (glyph, label, optional tone, optional hairline above) and a press handler each.
// [OUTPUT]: HeaderMenu — the ⋯ bar button and its dropdown card, anchored under the bar's right edge.
// [POS]: Collapses secondary top-bar actions into one menu (Chat's Changes / Terminal / Close). A plain RN
//        Modal over a dimmed backdrop (OptionSheet's pattern): a few short rows need no native menu library.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { Ellipsis, type LucideIcon } from 'lucide-react-native';
import { useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text, XStack, YStack } from 'tamagui';

import { Icon, type IconTone } from '@/components/icon';
import { IconButton } from '@/components/icon-button';
import { Tap } from '@/components/tap';
import { colors, radii } from '@/theme/tokens';

export interface HeaderMenuItem {
  key: string;
  label: string;
  icon: LucideIcon;
  tone?: IconTone;
  /** Draw a hairline above the row (the closing group sits apart from the actions). */
  separated?: boolean;
  onPress: () => void;
}

/** The native-stack header bar height below the status bar. */
const BAR_HEIGHT = Platform.select({ ios: 44, default: 56 });

export function HeaderMenu({ label = 'More actions', items }: { label?: string; items: HeaderMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <>
      <IconButton as={Ellipsis} tone="muted" label={label} onPress={() => setOpen(true)} />
      <Modal visible={open} transparent animationType="fade" statusBarTranslucent onRequestClose={close}>
        <SafeAreaView edges={['top']} style={{ flex: 1 }}>
          <Pressable style={{ flex: 1 }} onPress={close} accessibilityLabel="Close menu">
            <XStack justifyContent="flex-end" paddingTop={BAR_HEIGHT} paddingRight={6}>
              <YStack
                backgroundColor={colors.surface}
                borderColor={colors.border}
                borderWidth={1}
                borderRadius={radii.md}
                paddingVertical={4}
                minWidth={188}
                style={{
                  shadowColor: '#000000',
                  shadowOpacity: 0.45,
                  shadowRadius: 18,
                  shadowOffset: { width: 0, height: 10 },
                  elevation: 14,
                }}>
                {items.map((item) => (
                  <YStack key={item.key}>
                    {item.separated ? (
                      <YStack height={StyleSheet.hairlineWidth} backgroundColor={colors.border} marginVertical={4} />
                    ) : null}
                    <Tap
                      role="button"
                      accessibilityLabel={item.label}
                      onPress={() => {
                        close();
                        item.onPress();
                      }}
                      paddingHorizontal={14}
                      paddingVertical={11}
                      gap={10}
                      flexDirection="row"
                      alignItems="center">
                      <Icon as={item.icon} size="sm" tone={item.tone ?? 'muted'} />
                      <Text color={colors.text} fontSize={14} fontWeight="500">
                        {item.label}
                      </Text>
                    </Tap>
                  </YStack>
                ))}
              </YStack>
            </XStack>
          </Pressable>
        </SafeAreaView>
      </Modal>
    </>
  );
}
