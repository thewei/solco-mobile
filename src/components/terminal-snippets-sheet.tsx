// [INPUT]: the saved snippets, this session's recent lines, the composer draft and the actions on them.
// [OUTPUT]: TerminalSnippetsSheet — "Snippets": Saved and Recent rows in mono; tap a row to put it in the composer, ▶ runs it now, ＋ keeps a recent line, × forgets a snippet.
// [POS]: Terminal composer helper (designs/mobile-t3-redesign `terminal-snippets`). Snippets are the user's explicit saves; recent lines are memory-only (see terminal-snippets.ts).
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { Platform, Pressable, View } from 'react-native';
import { Text } from 'tamagui';

import { Icon, type Glyph } from '@/components/icon';
import { OptionSheet } from '@/components/option-sheet';
import type { Snippet } from '@/lib/terminal-snippets';
import { IconPlayerPlay, IconPlus, IconX } from '@/theme/glyphs';
import { colors, metrics, monoFont, radii, row, type as typeScale } from '@/theme/tokens';

const MONO = Platform.select({ ios: monoFont.ios, default: monoFont.android });

function Action({ glyph, label, onPress }: { glyph: Glyph; label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({ width: metrics.touch, height: metrics.touch, borderRadius: metrics.touch / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? colors.navIndicator : 'transparent' })}>
      <Icon as={glyph} size="lg" tone="muted" />
    </Pressable>
  );
}

function Line({ text, actions, onPick }: { text: string; actions: { label: string; glyph: Glyph; onPress: () => void }[]; onPick: () => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: row.minHeight, paddingLeft: row.padX, paddingRight: 4, borderRadius: radii.lg }}>
      <Pressable accessibilityRole="button" onPress={onPick} style={{ flex: 1, minWidth: 0, paddingVertical: 8 }}>
        <Text color={colors.text} fontSize={typeScale.label.fontSize} lineHeight={typeScale.label.lineHeight} fontFamily={MONO} numberOfLines={2}>{text}</Text>
      </Pressable>
      {actions.map((a) => (
        <Action key={a.label} glyph={a.glyph} label={a.label} onPress={a.onPress} />
      ))}
    </View>
  );
}

const Heading = ({ text }: { text: string }) => (
  <Text color={colors.textMuted} fontSize={typeScale.label.fontSize} lineHeight={typeScale.label.lineHeight} paddingHorizontal={row.padX} paddingTop={10} paddingBottom={4}>{text}</Text>
);
const Hint = ({ text }: { text: string }) => (
  <Text color={colors.textMuted} fontSize={typeScale.small.fontSize} lineHeight={typeScale.small.lineHeight} paddingHorizontal={row.padX} paddingVertical={8}>{text}</Text>
);

export function TerminalSnippetsSheet({
  visible,
  onClose,
  snippets,
  recent,
  draft,
  onPick,
  onRun,
  onSave,
  onRemove,
}: {
  visible: boolean;
  onClose: () => void;
  snippets: readonly Snippet[];
  recent: readonly string[];
  draft: string;
  onPick: (text: string) => void;
  onRun: (text: string) => void;
  onSave: (text: string) => void;
  onRemove: (id: string) => void;
}) {
  const canSaveDraft = draft.trim() !== '' && !/[\r\n]/.test(draft) && !snippets.some((s) => s.text === draft.trim());
  return (
    <OptionSheet visible={visible} title="Snippets" onClose={onClose}>
      {canSaveDraft ? (
        <Pressable accessibilityRole="button" onPress={() => onSave(draft)} style={{ minHeight: row.minHeight, justifyContent: 'center', paddingHorizontal: row.padX }}>
          <Text color={colors.accentText} fontSize={typeScale.label.fontSize} lineHeight={typeScale.label.lineHeight} fontWeight="500" numberOfLines={1}>Save “{draft.trim()}”</Text>
        </Pressable>
      ) : null}
      <Heading text="Saved" />
      {snippets.length === 0 ? (
        <Hint text="Type a line in the composer, then save it here." />
      ) : (
        snippets.map((s) => (
          <Line
            key={s.id}
            text={s.text}
            onPick={() => onPick(s.text)}
            actions={[
              { label: 'Run snippet', glyph: IconPlayerPlay, onPress: () => onRun(s.text) },
              { label: 'Remove snippet', glyph: IconX, onPress: () => onRemove(s.id) },
            ]}
          />
        ))
      )}
      <Heading text="Recent in this session" />
      {recent.length === 0 ? (
        <Hint text="Lines you send show up here." />
      ) : (
        recent.map((line) => (
          <Line
            key={line}
            text={line}
            onPick={() => onPick(line)}
            actions={[
              ...(snippets.some((s) => s.text === line) ? [] : [{ label: 'Save line', glyph: IconPlus, onPress: () => onSave(line) }]),
              { label: 'Run line', glyph: IconPlayerPlay, onPress: () => onRun(line) },
            ]}
          />
        ))
      )}
    </OptionSheet>
  );
}
