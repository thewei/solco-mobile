// [INPUT]: children / a label.
// [OUTPUT]: SectionLabel (the small upper-case group caption), Card (the one bordered surface) and CardRow (a card drawn row by row, for virtualized lists).
// [POS]: The page-level layout vocabulary: gutter = spacing.screen, caption sits row.padX in from the card's edge,
//        card corner = radii.lg. Home, Sessions, Connect, Quota and Changes build on these; none restates the
//        border / radius / background itself.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { Text, YStack, type YStackProps } from 'tamagui';

import { colors, radii, row } from '@/theme/tokens';

const SECTION_TOP = 16;

export function SectionLabel({ children, inset = true }: { children: string; inset?: boolean }) {
  return (
    <Text
      color={colors.textSubtle}
      fontSize={12}
      fontWeight="700"
      letterSpacing={0.6}
      paddingHorizontal={inset ? row.padX : 0}
      paddingTop={SECTION_TOP}
      paddingBottom={6}>
      {children.toUpperCase()}
    </Text>
  );
}

export function Card({ active = false, padded = false, children, ...rest }: { active?: boolean; padded?: boolean } & YStackProps) {
  return (
    <YStack
      backgroundColor={colors.surface}
      borderColor={active ? colors.accent : colors.border}
      borderWidth={1}
      borderRadius={radii.lg}
      overflow="hidden"
      padding={padded ? row.padX : 0}
      gap={padded ? 8 : 0}
      {...rest}>
      {children}
    </YStack>
  );
}

/**
 * One row of a card that is drawn row by row (a virtualized list cannot wrap its rows in one Card): the first row
 * owns the top corners, the last the bottom corners, and every row draws the divider above itself.
 */
export function CardRow({ first = false, last = false, children }: { first?: boolean; last?: boolean; children: React.ReactNode }) {
  return (
    <YStack
      backgroundColor={colors.surface}
      borderColor={colors.border}
      borderLeftWidth={1}
      borderRightWidth={1}
      borderTopWidth={1}
      borderBottomWidth={last ? 1 : 0}
      borderTopLeftRadius={first ? radii.lg : 0}
      borderTopRightRadius={first ? radii.lg : 0}
      borderBottomLeftRadius={last ? radii.lg : 0}
      borderBottomRightRadius={last ? radii.lg : 0}
      overflow="hidden">
      {children}
    </YStack>
  );
}
