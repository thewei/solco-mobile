// [INPUT]: a Tabler glyph (theme/glyphs), a size step, a tone.
// [OUTPUT]: Icon (the glyph at the app's one stroke voice) and IconTile (the glyph on a rounded, tinted tile).
// [POS]: The only way a screen draws an icon. Stroke width and the tile's corner live in theme/tokens (`icons`,
//        `tile`); no screen passes its own size number or color string. Tabler's 24-unit viewBox scales the
//        stroke with the icon (a 16 px chevron draws a 1.3 px line), as in the design; a thicker `stroke` is
//        passed only where the design asks (chevrons).
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import type { Icon as TablerIcon } from '@tabler/icons-react-native';
import { View } from 'react-native';

import { colors, icons, tile, themed } from '@/theme/tokens';

/** A glyph from theme/glyphs. */
export type Glyph = TablerIcon;
export type IconSize = keyof Omit<typeof icons, 'stroke'>;
export type IconTone = 'neutral' | 'muted' | 'subtle' | 'text' | 'accent' | 'attention' | 'success' | 'danger' | 'onAccent';

const TONE: Record<IconTone, string> = themed(() => ({
  neutral: colors.textMuted,
  muted: colors.textMuted,
  subtle: colors.chevron,
  text: colors.text,
  accent: colors.accentText,
  attention: colors.attention,
  success: colors.success,
  danger: colors.danger,
  onAccent: colors.onAccent,
}));

/** The color a tone draws with, for the places that paint something else (a tab label) in the same voice. */
export const toneColor = (tone: IconTone): string => TONE[tone];

export function Icon({ as: Glyph, size = 'md', tone = 'neutral', stroke = icons.stroke }: { as: Glyph; size?: IconSize; tone?: IconTone; stroke?: number }) {
  return <Glyph size={icons[size]} color={TONE[tone]} strokeWidth={stroke} />;
}

const TILE_BG: Partial<Record<IconTone, string>> = themed(() => ({
  accent: colors.accentSoft,
  attention: colors.attentionSoft,
  success: colors.successSoft,
}));

export function IconTile({ as, tone = 'neutral' }: { as: Glyph; tone?: IconTone }) {
  return (
    <View
      style={{
        width: tile.size,
        height: tile.size,
        borderRadius: tile.radius,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: TILE_BG[tone] ?? colors.surfaceRaised,
      }}>
      <Icon as={as} tone={tone} />
    </View>
  );
}
