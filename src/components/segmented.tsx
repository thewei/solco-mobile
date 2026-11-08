// [INPUT]: the options (id + label), the selected id and a change handler.
// [OUTPUT]: Segmented — a pill-shaped two-or-three-way switch: 44 dp segments on the grouped fill, the selected one a step lighter.
// [POS]: Review's Unstaged / Staged switch (designs/mobile-t3-redesign `.seg`); any other either-or that is a view, not a setting.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { Pressable, View } from 'react-native';
import { Text } from 'tamagui';

import { colors, metrics, radii, type as typeScale } from '@/theme/tokens';

export function Segmented<T extends string>({ options, value, onChange }: { options: readonly { id: T; label: string }[]; value: T; onChange: (id: T) => void }) {
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: 'row', marginTop: 4, marginHorizontal: 16, marginBottom: 8, padding: 2, borderRadius: radii.bubble, backgroundColor: colors.surfaceRaised }}>
      {options.map((option) => {
        const selected = option.id === value;
        return (
          <Pressable
            key={option.id}
            accessibilityRole="tab"
            accessibilityLabel={option.label}
            accessibilityState={{ selected }}
            onPress={() => onChange(option.id)}
            style={{ flex: 1, height: metrics.touch, borderRadius: metrics.touch / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: selected ? colors.segmentSelected : 'transparent' }}>
            <Text color={selected ? colors.text : colors.textMuted} fontSize={typeScale.label.fontSize} lineHeight={typeScale.label.lineHeight} fontWeight="500">{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
