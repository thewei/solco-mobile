// [INPUT]: the tree's workspaces, the Host's launch kinds and the current pick.
// [OUTPUT]: Chip (a small pill), FolderSheet (a Workspace tab | a known folder | any absolute Mac path) and
//           AgentSheet (the Host's agent kinds) — the pickers of a new session.
// [POS]: shared by Home's LaunchComposer and the full-page draft composer (`/compose`), so both choose a folder and an
//        agent the same way. Pure presentation: the pick is the caller's state, the Host owns every refusal.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { Check } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Input, Text, XStack, YStack } from 'tamagui';

import { Icon } from '@/components/icon';
import { OptionSheet } from '@/components/option-sheet';
import { Tap } from '@/components/tap';
import type { TreeWorkspace } from '@/contracts/host-v3';
import { folderName, knownFolders, targetFolder, targetLabel, validFolder, workspaceTargets, type LaunchTarget } from '@/features/host/launch-model';
import { colors, radii, row, spacing } from '@/theme/tokens';

export function Chip({ label, icon, active, onPress, accessibilityLabel }: { label: string; icon?: React.ReactNode; active?: boolean; onPress: () => void; accessibilityLabel?: string }) {
  return (
    <Tap role="button" accessibilityLabel={accessibilityLabel ?? label} onPress={onPress}>
      <XStack
        alignItems="center"
        gap="$1.5"
        paddingHorizontal="$2.5"
        height={32}
        borderRadius={radii.pill}
        borderWidth={1}
        borderColor={active ? colors.accent : colors.border}
        backgroundColor={active ? colors.accentSoft : colors.surfaceRaised}>
        {icon}
        <Text color={active ? colors.text : colors.textMuted} fontSize={12.5} fontWeight="600" numberOfLines={1} flexShrink={1}>{label}</Text>
      </XStack>
    </Tap>
  );
}

function Row({ title, caption, selected, onPress }: { title: string; caption?: string; selected?: boolean; onPress: () => void }) {
  return (
    <Tap role="button" accessibilityLabel={title} onPress={onPress}>
      <XStack alignItems="center" gap={row.gap} paddingHorizontal={spacing.screen} minHeight={row.minHeight - 8}>
        <YStack flex={1}>
          <Text color={colors.text} fontSize={15} fontWeight="600" numberOfLines={1}>{title}</Text>
          {caption ? <Text color={colors.textSubtle} fontSize={12} numberOfLines={1}>{caption}</Text> : null}
        </YStack>
        {selected ? <Icon as={Check} size="sm" tone="accent" /> : null}
      </XStack>
    </Tap>
  );
}

export function FolderSheet({ visible, workspaces, target, onClose, onPick, workspacesOnly = false }: {
  visible: boolean;
  /** A device: its Workspaces only — a typed or remembered path would be looked up on the Mac, not on the device. */
  workspacesOnly?: boolean;
  workspaces: readonly TreeWorkspace[];
  target: LaunchTarget | null;
  onClose: () => void;
  onPick: (target: LaunchTarget) => void;
}) {
  const [folderDraft, setFolderDraft] = useState('');
  const wsTargets = useMemo(() => workspaceTargets(workspaces), [workspaces]);
  const folders = useMemo(() => (workspacesOnly ? [] : knownFolders(workspaces)), [workspaces, workspacesOnly]);
  const folderOk = validFolder(folderDraft);
  return (
    <OptionSheet visible={visible} title="Folder" onClose={onClose}>
      {wsTargets.map((t) => (
        <Row key={t.type === 'workspace' ? t.id : t.path} title={targetLabel(t)} caption={targetFolder(t)}
          selected={target?.type === 'workspace' && t.type === 'workspace' && target.id === t.id} onPress={() => onPick(t)} />
      ))}
      {folders.map((path) => (
        <Row key={path} title={folderName(path)} caption={path}
          selected={target?.type === 'path' && target.path === path} onPress={() => onPick({ type: 'path', path })} />
      ))}
      {workspacesOnly ? null : <YStack paddingHorizontal="$4" paddingTop="$3" gap="$2">
        <Text color={colors.textMuted} fontSize={12} fontWeight="700" letterSpacing={0.6}>ANOTHER FOLDER ON THE MAC</Text>
        <XStack gap="$2" alignItems="center">
          <Input
            flex={1}
            height={44}
            value={folderDraft}
            onChangeText={setFolderDraft}
            placeholder="/Users/you/project"
            placeholderTextColor="$placeholderColor"
            autoCapitalize="none"
            autoCorrect={false}
            color={colors.text}
            backgroundColor={colors.surfaceRaised}
            borderColor={folderDraft && !folderOk ? colors.danger : colors.border}
            borderRadius={radii.md}
            paddingHorizontal="$3"
          />
          <Tap height={44} paddingHorizontal={16} borderRadius={radii.pill} alignItems="center" justifyContent="center"
            backgroundColor={folderOk ? colors.accent : colors.surfaceRaised} disabled={!folderOk} role="button"
            accessibilityLabel="Use this folder" onPress={() => onPick({ type: 'path', path: folderDraft.trim() })}>
            <Text color={folderOk ? colors.canvas : colors.textSubtle} fontSize={14} fontWeight="700">Use</Text>
          </Tap>
        </XStack>
        {folderDraft && !folderOk ? <Text color={colors.danger} fontSize={11}>Use an absolute path, like /Users/you/project.</Text> : null}
      </YStack>}
    </OptionSheet>
  );
}

export function AgentSheet({ visible, kinds, agent, onClose, onPick }: {
  visible: boolean;
  kinds: readonly { id: string; label: string }[];
  agent: string | null;
  onClose: () => void;
  onPick: (id: string) => void;
}) {
  return (
    <OptionSheet visible={visible} title="Agent" onClose={onClose}>
      {kinds.map((k) => (
        <Row key={k.id} title={k.label} selected={k.id === agent} onPress={() => onPick(k.id)} />
      ))}
    </OptionSheet>
  );
}
