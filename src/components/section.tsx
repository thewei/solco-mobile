// [INPUT]: children / a label.
// [OUTPUT]: SectionLabel (the muted group caption) and Card (the one grouped surface of the detail pages).
// [POS]: The detail pages' layout vocabulary (Assistants, Automations, Remote Desktop, the cards of Hosts): gutter =
//        spacing.screen, the caption sits 14 dp in from the card's edge, and the card is the redesign's grouped fill
//        (`surfaceRaised`, 28 dp corner, no border — designs/mobile-t3-redesign `.group`). Pages with plain rows use
//        `list-group` (`Section` / `ListRow`) instead; none of them restates the radius, fill or caption voice itself.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { Text, YStack, type YStackProps } from 'tamagui';

import { colors, radii, row, type as typeScale } from '@/theme/tokens';

export function SectionLabel({ children, inset = true }: { children: string; inset?: boolean }) {
  return (
    <Text
      accessibilityRole="header"
      color={colors.textMuted}
      fontSize={typeScale.label.fontSize}
      lineHeight={typeScale.label.lineHeight}
      fontWeight="500"
      paddingHorizontal={inset ? 14 : 0}
      paddingTop={14}
      paddingBottom={7}>
      {children}
    </Text>
  );
}

export function Card({ padded = false, children, ...rest }: { padded?: boolean } & YStackProps) {
  return (
    <YStack
      backgroundColor={colors.surfaceRaised}
      borderRadius={radii.lg}
      overflow="hidden"
      padding={padded ? row.padX : 0}
      gap={padded ? 8 : 0}
      {...rest}>
      {children}
    </YStack>
  );
}
