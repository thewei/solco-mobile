import { config as baseConfig } from '@tamagui/config';
import { Platform } from 'react-native';
import { createFont, createTamagui } from 'tamagui';

import { fontFamilies, monoFont, palettes, type ColorSet } from './src/theme/tokens';

// One Tamagui theme per scheme, built from that scheme's own palette (never the live `colors`: both themes must exist
// whichever scheme is active when this module loads).
const solcoTheme = (base: Record<string, string>, c: ColorSet, strong: string) => ({
  ...base,
  background: c.canvas,
  backgroundHover: c.surface,
  backgroundPress: c.user,
  backgroundFocus: c.user,
  backgroundStrong: c.surfaceRaised,
  color: c.text,
  colorHover: strong,
  colorPress: strong,
  colorFocus: strong,
  placeholderColor: c.textMuted,
  borderColor: c.border,
  borderColorHover: c.borderStrong,
  borderColorFocus: c.accent,
  borderColorPress: c.navIndicator,
});

const solcoDark = solcoTheme(baseConfig.themes.dark, palettes.dark, '#FFFFFF');
const solcoLight = solcoTheme(baseConfig.themes.light, palettes.light, '#000000');

// React Native on Android selects a custom font by family name, so every weight a screen asks for is mapped onto
// one of the three loaded DM Sans files (createFont fills the unlisted weights from their neighbours).
const dmSansFace = {
  400: { normal: fontFamilies.regular },
  500: { normal: fontFamilies.medium },
  600: { normal: fontFamilies.medium },
  650: { normal: fontFamilies.bold },
  700: { normal: fontFamilies.bold },
  800: { normal: fontFamilies.bold },
  900: { normal: fontFamilies.bold },
};

const body = createFont({ ...baseConfig.fonts.body, family: fontFamilies.regular, face: dmSansFace });
const heading = createFont({ ...baseConfig.fonts.heading, family: fontFamilies.regular, face: dmSansFace });
// `$mono` reaches React Native as a single family name; Android and iOS need their own platform face, not a CSS stack.
const mono = createFont({
  ...baseConfig.fonts.mono,
  family: Platform.select({ ios: monoFont.ios, android: monoFont.android, default: monoFont.web }),
});

// `defaultFont` only resolves font tokens; on React Native nothing inherits a family, so a `Text` that names none draws in the
// system face. One default here puts every `Text` on DM Sans (a CJK glyph DM Sans lacks still falls back to the system font).
// Typed loosely on purpose: `TextProps` is derived from this very config, so naming it here would make the config circular.
const textDefaults: Record<string, any> = { Text: { fontFamily: '$body' } };

export const tamaguiConfig = createTamagui({
  ...baseConfig,
  fonts: { ...baseConfig.fonts, body, heading, mono },
  themes: {
    ...baseConfig.themes,
    solcoDark,
    solcoLight,
  },
  settings: {
    ...baseConfig.settings,
    defaultFont: 'body',
  },
  defaultProps: textDefaults,
});

export type TamaguiConfig = typeof tamaguiConfig;

declare module 'tamagui' {
  interface TamaguiCustomConfig extends TamaguiConfig {}
}

export default tamaguiConfig;
