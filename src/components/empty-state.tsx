// [INPUT]: a glyph, a title, a sentence, and an optional primary action.
// [OUTPUT]: EmptyState — a 64 dp round glyph, a 18 dp title, a muted sentence (≤ 280 dp wide) and one primary button,
//           centered in the space the list would have filled.
// [POS]: The one "nothing here" and "could not load" face (designs/mobile-t3-redesign `.empty`): No chats yet, No chats match,
//        Pair your first host, Trash is empty. `top` keeps it near the top of a short sub-view instead of centering it; `flush` seats
//        it straight under the app bar, as the design draws Chats and Usage (their scroll wrapper never stretches it); `spin` turns
//        the glyph (a "Connecting…" state).
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { View } from 'react-native';
import { Text } from 'tamagui';

import { Icon, type Glyph } from '@/components/icon';
import { Spin } from '@/components/motion';
import { PillButton } from '@/components/pill-button';
import { colors, type as typeScale } from '@/theme/tokens';

export function EmptyState({ icon, title, text, action, onAction, top = false, flush = false, spin = false }: { icon: Glyph; title: string; text: string; action?: string; onAction?: () => void; top?: boolean; flush?: boolean; spin?: boolean }) {
  const pinned = top || flush;
  return (
    <View style={{ flex: pinned ? undefined : 1, alignItems: 'center', justifyContent: pinned ? 'flex-start' : 'center', gap: 8, paddingHorizontal: 32, paddingTop: top ? 72 : 0, paddingBottom: pinned ? 0 : 64 }}>
      <View style={{ width: 64, height: 64, borderRadius: 32, marginBottom: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceRaised }}>
        {spin ? (
          <Spin>
            <Icon as={icon} size="hero" tone="muted" />
          </Spin>
        ) : (
          <Icon as={icon} size="hero" tone="muted" />
        )}
      </View>
      <Text accessibilityRole="header" color={colors.text} fontSize={typeScale.title.fontSize} lineHeight={typeScale.title.lineHeight} fontWeight="500" textAlign="center">{title}</Text>
      <Text color={colors.textMuted} fontSize={typeScale.label.fontSize} lineHeight={typeScale.label.lineHeight} textAlign="center" maxWidth={280}>{text}</Text>
      {action && onAction ? (
        <View style={{ marginTop: 12 }}>
          <PillButton label={action} onPress={onAction} />
        </View>
      ) : null}
    </View>
  );
}
