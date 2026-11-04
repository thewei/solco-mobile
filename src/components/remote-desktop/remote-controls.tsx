// [INPUT]: titles, values and callbacks from the Remote Desktop screens.
// [OUTPUT]: Group (an inset card with a small caps title), ToggleRow (the platform Switch), SegmentedRow
//           (one-of-N pill control), ChoiceRow (radio-style pick with a check) and ActionRow (tap row).
// [POS]: The one face of the options sheet and the lobby's settings — platform Switch, grouped inset cards,
//        hairline separators — so the screens share rows instead of restating radius/padding/colour.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { Check } from 'lucide-react-native';
import { Children, Fragment } from 'react';
import { Switch } from 'react-native';
import { Text, XStack, YStack } from 'tamagui';

import { Icon } from '@/components/icon';
import { Tap } from '@/components/tap';
import { colors, radii } from '@/theme/tokens';

/** A titled inset card; children are rows and get hairlines between them. */
export function Group({ title, footer, children }: { title?: string; footer?: string; children: React.ReactNode }) {
  const rows = Children.toArray(children).filter(Boolean);
  return (
    <YStack gap="$1.5" paddingHorizontal="$4" paddingTop="$3">
      {title ? <Text color={colors.textSubtle} fontSize={11} fontWeight="700" letterSpacing={0.6} paddingLeft="$1">{title.toUpperCase()}</Text> : null}
      <YStack borderRadius={radii.md} backgroundColor={colors.surfaceRaised} overflow="hidden">
        {rows.map((row, i) => (
          <Fragment key={i}>
            {i > 0 ? <YStack height={1} marginLeft="$3.5" backgroundColor={colors.border} /> : null}
            {row}
          </Fragment>
        ))}
      </YStack>
      {footer ? <Text color={colors.textMuted} fontSize={12} lineHeight={17} paddingHorizontal="$1">{footer}</Text> : null}
    </YStack>
  );
}

export function ToggleRow({ title, hint, value, onValueChange, disabled }: { title: string; hint?: string; value: boolean; onValueChange: (next: boolean) => void; disabled?: boolean }) {
  return (
    <XStack alignItems="center" paddingHorizontal="$3.5" paddingVertical="$2.5" gap="$3" opacity={disabled ? 0.5 : 1}>
      <YStack flex={1} gap={2}>
        <Text color={colors.text} fontSize={15} fontWeight="600">{title}</Text>
        {hint ? <Text color={colors.textMuted} fontSize={12} lineHeight={17}>{hint}</Text> : null}
      </YStack>
      <Switch
        accessibilityLabel={title}
        value={value}
        disabled={disabled}
        onValueChange={onValueChange}
        trackColor={{ false: colors.border, true: colors.accent }}
        thumbColor="#FFFFFF"
      />
    </XStack>
  );
}

export function SegmentedRow<T extends string>({ label, options, value, onChange, hint }: { label: string; options: readonly { value: T; title: string }[]; value: T; onChange: (next: T) => void; hint?: string }) {
  return (
    <YStack paddingHorizontal="$3.5" paddingVertical="$2.5" gap="$2">
      <Text color={colors.text} fontSize={15} fontWeight="600">{label}</Text>
      <XStack padding={3} borderRadius={radii.pill} backgroundColor={colors.canvas}>
        {options.map((o) => {
          const on = o.value === value;
          return (
            <Tap key={o.value} flex={1} role="button" accessibilityLabel={o.title} onPress={() => onChange(o.value)} paddingVertical="$2" alignItems="center" borderRadius={radii.pill} backgroundColor={on ? colors.accent : 'transparent'}>
              <Text color={on ? '#FFFFFF' : colors.textMuted} fontSize={13} fontWeight="650">{o.title}</Text>
            </Tap>
          );
        })}
      </XStack>
      {hint ? <Text color={colors.textMuted} fontSize={12}>{hint}</Text> : null}
    </YStack>
  );
}

export function ChoiceRow({ title, hint, selected, onPress }: { title: string; hint?: string; selected: boolean; onPress: () => void }) {
  return (
    <Tap role="button" accessibilityLabel={title} onPress={onPress} flexDirection="row" alignItems="center" paddingHorizontal="$3.5" paddingVertical="$2.5" gap="$3">
      <YStack flex={1} gap={2}>
        <Text color={selected ? colors.accent : colors.text} fontSize={15} fontWeight="600">{title}</Text>
        {hint ? <Text color={colors.textMuted} fontSize={12}>{hint}</Text> : null}
      </YStack>
      {selected ? <Icon as={Check} tone="accent" /> : null}
    </Tap>
  );
}

export function ActionRow({ title, hint, onPress }: { title: string; hint?: string; onPress: () => void }) {
  return (
    <Tap role="button" accessibilityLabel={title} onPress={onPress} paddingHorizontal="$3.5" paddingVertical="$3" gap={2}>
      <Text color={colors.text} fontSize={15} fontWeight="600">{title}</Text>
      {hint ? <Text color={colors.textMuted} fontSize={12}>{hint}</Text> : null}
    </Tap>
  );
}
