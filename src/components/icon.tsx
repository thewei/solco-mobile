// [INPUT]: a lucide glyph, a size step, a tone.
// [OUTPUT]: Icon (the glyph at the app's one stroke voice) and IconTile (the glyph on a rounded, tinted tile).
// [POS]: The only way a screen draws an icon. Stroke width, absolute-pixel scaling and the tile's corner live
//        in theme/tokens (`icons`, `tile`); no screen passes its own size number, color string or strokeWidth
//        (thin 1.5 px round-capped lines, like iOS symbols).
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import type { LucideIcon } from 'lucide-react-native';
import { View } from 'react-native';

import { colors, icons, tile } from '@/theme/tokens';

export type IconSize = 'sm' | 'md' | 'lg';
export type IconTone = 'neutral' | 'muted' | 'subtle' | 'text' | 'accent' | 'attention' | 'success' | 'danger' | 'onAccent';

const TONE: Record<IconTone, string> = {
  neutral: colors.textMuted,
  muted: colors.textMuted,
  subtle: colors.textSubtle,
  text: colors.text,
  accent: colors.accent,
  attention: colors.attention,
  success: colors.success,
  danger: colors.danger,
  onAccent: '#FFFFFF',
};

export function Icon({ as: Glyph, size = 'md', tone = 'neutral' }: { as: LucideIcon; size?: IconSize; tone?: IconTone }) {
  return <Glyph size={icons[size]} color={TONE[tone]} strokeWidth={icons.stroke} absoluteStrokeWidth />;
}

const TILE_BG: Partial<Record<IconTone, string>> = {
  accent: colors.accentSoft,
  attention: colors.attentionSoft,
  success: colors.successSoft,
};

export function IconTile({ as, tone = 'neutral' }: { as: LucideIcon; tone?: IconTone }) {
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
