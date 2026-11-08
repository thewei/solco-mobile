// [INPUT]: the tree's workspaces, the Host's launch kinds and the current pick.
// [OUTPUT]: Chip (the text pill of designs/mobile-t3-redesign `.chip`: a 44 dp touch box around a 32 dp fill), FolderSheet (the
//           Workspace sheet: a Workspace tab | a known folder | any absolute Mac path) and AgentSheet (the Host's agent
//           kinds) — the pickers of a new session.
// [POS]: shared by the New chat page (`/compose`) and LaunchComposer (share, Automations' "Let an Agent Draft"), so both
//        choose a workspace and an agent the same way. Pure presentation: the pick is the caller's state, the Host owns
//        every refusal. Rows are the grouped lists' own `ListRow`, with the check on the current pick.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { useMemo, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { Text } from 'tamagui';

import { fillKey } from '@/components/fill-key';
import { ListRow } from '@/components/list-group';
import { OptionSheet } from '@/components/option-sheet';
import { PillButton } from '@/components/pill-button';
import type { TreeWorkspace } from '@/contracts/host-v3';
import { folderName, knownFolders, targetFolder, targetLabel, validFolder, workspaceTargets, type LaunchTarget } from '@/features/host/launch-model';
import { colors, fontFamilies, metrics, radii, type as typeScale } from '@/theme/tokens';

export function Chip({ label, icon, trailing, active, onPress, accessibilityLabel }: { label: string; icon?: React.ReactNode; trailing?: React.ReactNode; active?: boolean; onPress: () => void; accessibilityLabel?: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      style={{ height: metrics.touch, marginVertical: -6, justifyContent: 'center' }}>
      {({ pressed }) => {
        const filled = active === true || pressed;
        return (
          <View key={fillKey(filled)} style={{ height: 32, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, borderRadius: radii.control, backgroundColor: filled ? colors.surfaceRaised : 'transparent' }}>
            {icon}
            <Text color={active ? colors.text : colors.textMuted} fontSize={typeScale.label.fontSize} lineHeight={typeScale.label.lineHeight} numberOfLines={1} flexShrink={1}>{label}</Text>
            {trailing}
          </View>
        );
      }}
    </Pressable>
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
    <OptionSheet visible={visible} title="Workspace" onClose={onClose}>
      {wsTargets.map((t) => (
        <ListRow
          key={t.type === 'workspace' ? t.id : t.path}
          label={targetLabel(t)}
          description={targetFolder(t)}
          chevron={false}
          checked={target?.type === 'workspace' && t.type === 'workspace' && target.id === t.id}
          onPress={() => onPick(t)}
        />
      ))}
      {folders.map((path) => (
        <ListRow key={path} label={folderName(path)} description={path} chevron={false} checked={target?.type === 'path' && target.path === path} onPress={() => onPick({ type: 'path', path })} />
      ))}
      {workspacesOnly ? null : (
        <View style={{ paddingHorizontal: 16, paddingTop: 12, gap: 8 }}>
          <Text color={colors.textMuted} fontSize={typeScale.label.fontSize} lineHeight={typeScale.label.lineHeight} fontWeight="500">Another folder on the Mac</Text>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <TextInput
              accessibilityLabel="Folder path"
              value={folderDraft}
              onChangeText={setFolderDraft}
              placeholder="/Users/you/project"
              placeholderTextColor={colors.textSubtle}
              autoCapitalize="none"
              autoCorrect={false}
              style={{
                flex: 1,
                height: 48,
                paddingHorizontal: 14,
                borderRadius: radii.control,
                borderWidth: 1,
                borderColor: folderDraft && !folderOk ? colors.danger : colors.border,
                backgroundColor: colors.surface,
                color: colors.text,
                fontFamily: fontFamilies.regular,
                fontSize: typeScale.body.fontSize,
              }}
            />
            <PillButton label="Use" disabled={!folderOk} onPress={() => onPick({ type: 'path', path: folderDraft.trim() })} />
          </View>
          {folderDraft && !folderOk ? <Text color={colors.danger} fontSize={typeScale.caption.fontSize} lineHeight={typeScale.caption.lineHeight}>Use an absolute path, like /Users/you/project.</Text> : null}
        </View>
      )}
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
        <ListRow key={k.id} label={k.label} chevron={false} checked={k.id === agent} onPress={() => onPick(k.id)} />
      ))}
    </OptionSheet>
  );
}
