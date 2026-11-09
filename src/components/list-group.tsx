// [INPUT]: titles, rows (glyph, label, optional description / detail / check / chevron) and a press handler per row.
// [OUTPUT]: Section (an optional title over one rounded grouped fill, an optional footer), ListRow (a row of that fill),
//           Shelf (the hairline-led label above a thread list), MoreButton (the dashed "Show more") and Hint (a quiet
//           explanatory line).
// [POS]: The page-level list vocabulary of the redesign (designs/mobile-t3-redesign `.sect` / `.group` / `.lrow` / `.shelf` /
//        `.hint`): Settings, Hosts, Workspaces, Workspace, Assistants, Changes controls. No dividers inside a group;
//        the group's 28 dp corner, 17.5 dp gutter and 49 / 63 dp row heights live here and nowhere else. The design's
//        CSS margins collapse (`.sect` 0 0 8, `.stitle` 14 0 7, a page's first `.sect` 12), so the gap above a Section is
//        decided here, once, and the page's first Section says `first` instead of padding its scroll.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { Pressable, Switch, View } from 'react-native';
import { Text } from 'tamagui';

import { Icon, type Glyph, type IconTone } from '@/components/icon';
import { IconCheck, IconChevronRight } from '@/theme/glyphs';
import { colors, radii, spacing, type as typeScale } from '@/theme/tokens';

export function Section({ title, footer, first = false, children }: { title?: string; footer?: string; first?: boolean; children: React.ReactNode }) {
  // Collapsed margins: a titled Section sits 14 below the one above (8 bottom + 6 here) or 14 below the app bar; an untitled
  // first one sits 12 below it.
  const marginTop = title ? (first ? 14 : 6) : first ? spacing.firstSection : 0;
  return (
    <View style={{ marginHorizontal: spacing.screen, marginTop, marginBottom: 8 }}>
      {title ? (
        <Text accessibilityRole="header" color={colors.textMuted} fontSize={typeScale.label.fontSize} lineHeight={typeScale.label.lineHeight} fontWeight="500" paddingHorizontal={14} marginBottom={7}>
          {title}
        </Text>
      ) : null}
      <View style={{ backgroundColor: colors.surfaceRaised, borderRadius: radii.lg, overflow: 'hidden' }}>{children}</View>
      {footer ? (
        <Text color={colors.textMuted} fontSize={typeScale.label.fontSize} lineHeight={typeScale.label.lineHeight} paddingTop={8} paddingHorizontal={14}>
          {footer}
        </Text>
      ) : null}
    </View>
  );
}

export function ListRow({
  icon,
  leading,
  label,
  description,
  detail,
  checked = false,
  danger = false,
  chevron = true,
  disabled = false,
  onPress,
  accessibilityLabel,
  tone = 'text',
}: {
  icon?: Glyph;
  /** A custom 24 dp leading element instead of a glyph (the Primary Assistant's badge). */
  leading?: React.ReactNode;
  label: string;
  description?: string;
  /** The value on the right (a count, a branch), muted. */
  detail?: string;
  /** The current pick of a sheet: a check on the right instead of the chevron. */
  checked?: boolean;
  danger?: boolean;
  chevron?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
  tone?: IconTone;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled }}
      disabled={disabled || !onPress}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
        minHeight: description ? 63 : 49,
        paddingVertical: 10.5,
        paddingHorizontal: 14,
        opacity: disabled ? 0.45 : 1,
        backgroundColor: pressed ? colors.skeleton : 'transparent',
      })}>
      {leading ? <View style={{ width: 24, height: 24, alignItems: 'center', justifyContent: 'center' }}>{leading}</View> : icon ? <Icon as={icon} size="lg" tone={danger ? 'danger' : tone} /> : null}
      <View style={{ flex: 1, minWidth: 0, gap: 3.5 }}>
        <Text color={danger ? colors.danger : colors.text} fontSize={typeScale.body.fontSize} lineHeight={typeScale.body.lineHeight}>{label}</Text>
        {description ? <Text color={colors.textMuted} fontSize={typeScale.label.fontSize} lineHeight={typeScale.label.lineHeight}>{description}</Text> : null}
      </View>
      {detail ? (
        <Text color={colors.textMuted} fontSize={typeScale.label.fontSize} lineHeight={typeScale.label.lineHeight} maxWidth="40%" numberOfLines={1}>
          {detail}
        </Text>
      ) : null}
      {checked ? <Icon as={IconCheck} size="md" tone="accent" /> : chevron && onPress ? <Icon as={IconChevronRight} size="sm" tone="subtle" stroke={2.4} /> : null}
    </Pressable>
  );
}

export function SwitchRow({
  icon,
  label,
  description,
  value,
  onValueChange,
  disabled = false,
}: {
  icon?: Glyph;
  label: string;
  description?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
        minHeight: description ? 63 : 49,
        paddingVertical: 10.5,
        paddingHorizontal: 14,
        opacity: disabled ? 0.45 : 1,
      }}>
      {icon ? <Icon as={icon} size="lg" tone="text" /> : null}
      <View style={{ flex: 1, minWidth: 0, gap: 3.5 }}>
        <Text color={colors.text} fontSize={typeScale.body.fontSize} lineHeight={typeScale.body.lineHeight}>
          {label}
        </Text>
        {description ? (
          <Text color={colors.textMuted} fontSize={typeScale.label.fontSize} lineHeight={typeScale.label.lineHeight}>
            {description}
          </Text>
        ) : null}
      </View>
      <Switch
        accessibilityLabel={label}
        value={value}
        disabled={disabled}
        onValueChange={onValueChange}
        trackColor={{ false: colors.border, true: colors.accent }}
        thumbColor="#FFFFFF"
      />
    </View>
  );
}

/** The label above a thread list: a muted word (and count), then a hairline that runs to the edge. */
/**
 * `after`: the block directly above the shelf, when it has a bottom margin of its own (a Banner's 4, a Section's 8). CSS folds
 * that margin into the shelf's 14 px top margin, so the gap stays 14; React Native adds them, so the shelf gives it back.
 */
const SHELF_TOP = { banner: 10, section: 6 } as const;

export function Shelf({ label, count, after }: { label: string; count?: string; after?: keyof typeof SHELF_TOP }) {
  return (
    <View accessibilityRole="header" style={{ flexDirection: 'row', alignItems: 'center', gap: 8.75, marginTop: after ? SHELF_TOP[after] : 14, marginBottom: 5, paddingHorizontal: spacing.screen }}>
      <Text color={colors.textMuted} fontSize={typeScale.label.fontSize} lineHeight={typeScale.label.lineHeight} fontWeight="500">{label}</Text>
      {count ? <Text color={colors.textMuted} fontSize={typeScale.label.fontSize} lineHeight={typeScale.label.lineHeight} fontWeight="400">{count}</Text> : null}
      <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
    </View>
  );
}

export function Hint({ children }: { children: string }) {
  return (
    <Text color={colors.textMuted} fontSize={typeScale.label.fontSize} lineHeight={typeScale.label.lineHeight} marginTop={12} marginHorizontal={spacing.screen} paddingHorizontal={14}>
      {children}
    </Text>
  );
}

/** The dashed "Show more" button under a thread list. */
export function MoreButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        marginTop: 8,
        marginHorizontal: 16,
        paddingVertical: 13,
        borderRadius: radii.block,
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: colors.border,
        alignItems: 'center',
        backgroundColor: pressed ? colors.rowPressed : 'transparent',
      })}>
      <Text color={colors.textMuted} fontSize={typeScale.small.fontSize} lineHeight={typeScale.small.lineHeight}>{label}</Text>
    </Pressable>
  );
}
