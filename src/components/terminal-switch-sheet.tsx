// [INPUT]: the instance's panes, the current terminal and a switch callback.
// [OUTPUT]: TerminalSwitchSheet — "Terminals": every terminal of the Mac's workspaces as a row (workspace badge, pane title, workspace · tab, a check on this one).
// [POS]: Terminal ⋮ menu → Terminals (designs/mobile-t3-redesign `terminal-switch`). Switching replaces the route (no stack growth) through `paneRoute`.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { Pressable, View } from 'react-native';
import { Text } from 'tamagui';

import { Icon } from '@/components/icon';
import { OptionSheet } from '@/components/option-sheet';
import { WorkspaceBadge } from '@/components/thread-row';
import { paneTitle, type FlatPane } from '@/features/host/pane-model';
import { IconCheck } from '@/theme/glyphs';
import { colors, radii, row, type as typeScale } from '@/theme/tokens';

export function TerminalSwitchSheet({
  visible,
  onClose,
  panes,
  currentTerminalId,
  onSwitch,
}: {
  visible: boolean;
  onClose: () => void;
  panes: readonly FlatPane[];
  currentTerminalId: string;
  onSwitch: (pane: FlatPane) => void;
}) {
  return (
    <OptionSheet visible={visible} title="Terminals" onClose={onClose}>
      {panes.map((item) => {
        const here = item.pane.terminalId === currentTerminalId;
        return (
          <Pressable
            key={item.pane.terminalId}
            accessibilityRole="button"
            accessibilityState={{ selected: here }}
            onPress={() => (here ? onClose() : onSwitch(item))}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: row.gap, minHeight: row.minHeight, paddingHorizontal: row.padX, borderRadius: radii.lg, backgroundColor: pressed ? colors.navIndicator : 'transparent' })}>
            <WorkspaceBadge name={item.workspace.label} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text color={colors.text} fontSize={typeScale.body.fontSize} lineHeight={typeScale.body.lineHeight} numberOfLines={1}>{paneTitle(item.pane)}</Text>
              <Text color={colors.textMuted} fontSize={typeScale.small.fontSize} lineHeight={typeScale.small.lineHeight} numberOfLines={1}>{item.workspace.label} · {item.tabLabel}</Text>
            </View>
            {here ? <Icon as={IconCheck} size="lg" tone="accent" /> : null}
          </Pressable>
        );
      })}
    </OptionSheet>
  );
}
