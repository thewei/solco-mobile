// [INPUT]: the font size and color theme in force and their setters.
// [OUTPUT]: TerminalStyleSheet — "Font & theme": a font-size stepper (44 dp round − / +) over the five terminal color themes (swatch, name, check).
// [POS]: Terminal ⋮ menu → Font & theme (designs/mobile-t3-redesign `terminal-style`). Values go through `lib/terminal-prefs`; the sheet is the shared OptionSheet.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { Platform, Pressable, View } from 'react-native';
import { Text } from 'tamagui';

import { Icon } from '@/components/icon';
import { OptionSheet } from '@/components/option-sheet';
import { MAX_FONT_SIZE, MIN_FONT_SIZE, TERMINAL_THEMES, type TerminalThemeName } from '@/lib/terminal-prefs';
import { IconCheck, IconMinus, IconPlus } from '@/theme/glyphs';
import { colors, metrics, monoFont, radii, row, type as typeScale } from '@/theme/tokens';

const MONO = Platform.select({ ios: monoFont.ios, default: monoFont.android });

function Step({ glyph, label, disabled, onPress }: { glyph: typeof IconMinus; label: string; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({ width: metrics.touch, height: metrics.touch, borderRadius: metrics.touch / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? colors.navIndicator : colors.surfaceRaised, opacity: disabled ? 0.4 : 1 })}>
      <Icon as={glyph} size="lg" tone="text" />
    </Pressable>
  );
}

export function TerminalStyleSheet({
  visible,
  onClose,
  fontSize,
  onFontSize,
  theme,
  onTheme,
}: {
  visible: boolean;
  onClose: () => void;
  fontSize: number;
  onFontSize: (size: number) => void;
  theme: TerminalThemeName;
  onTheme: (name: TerminalThemeName) => void;
}) {
  return (
    <OptionSheet visible={visible} title="Font & theme" onClose={onClose}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: row.minHeight, paddingHorizontal: row.padX }}>
        <Text color={colors.text} fontSize={typeScale.body.fontSize} lineHeight={typeScale.body.lineHeight}>Font size</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Step glyph={IconMinus} label="Smaller font" disabled={fontSize <= MIN_FONT_SIZE} onPress={() => onFontSize(fontSize - 1)} />
          <Text color={colors.text} fontSize={typeScale.body.fontSize} fontWeight="500" minWidth={56} textAlign="center">{fontSize} pt</Text>
          <Step glyph={IconPlus} label="Larger font" disabled={fontSize >= MAX_FONT_SIZE} onPress={() => onFontSize(fontSize + 1)} />
        </View>
      </View>
      <Text color={colors.textMuted} fontSize={typeScale.label.fontSize} lineHeight={typeScale.label.lineHeight} paddingHorizontal={row.padX} paddingTop={10} paddingBottom={4}>Theme</Text>
      {(Object.keys(TERMINAL_THEMES) as TerminalThemeName[]).map((name) => {
        const t = TERMINAL_THEMES[name];
        const on = name === theme;
        return (
          <Pressable
            key={name}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            onPress={() => onTheme(name)}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: row.gap, minHeight: row.minHeight, paddingHorizontal: row.padX, borderRadius: radii.lg, backgroundColor: pressed ? colors.navIndicator : 'transparent' })}>
            <View style={{ width: 44, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: t.background, borderWidth: 1, borderColor: colors.border }}>
              <Text color={t.foreground} fontSize={13} fontWeight="700" fontFamily={MONO}>Aa</Text>
            </View>
            <Text flex={1} color={colors.text} fontSize={typeScale.body.fontSize} lineHeight={typeScale.body.lineHeight}>{t.label}</Text>
            {on ? <Icon as={IconCheck} size="lg" tone="accent" /> : null}
          </Pressable>
        );
      })}
    </OptionSheet>
  );
}
