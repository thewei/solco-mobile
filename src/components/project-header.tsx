// [INPUT]: the tree's Workspaces, the chosen Workspace (project-store) and an optional title.
// [OUTPUT]: ProjectHeader — the top bar of the scoped tabs: ≡ (the sessions drawer) and either a fixed title (Sessions)
//           or the project chip, which opens a sheet of the Mac's Workspaces; the pick is client-local.
// [POS]: The phone's counterpart of the desktop's project head shared by Changes / Sessions / Files. Choosing a
//        project never moves the Mac's focus.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { Check, ChevronDown, Menu } from 'lucide-react-native';
import { useState } from 'react';
import { Text, XStack } from 'tamagui';

import { Icon } from '@/components/icon';
import { IconButton } from '@/components/icon-button';
import { OptionSheet } from '@/components/option-sheet';
import { Tap } from '@/components/tap';
import type { TreeWorkspace } from '@/contracts/host-v3';
import { useOpenDrawer } from '@/lib/use-open-drawer';
import { useProjectStore } from '@/state/project-store';
import { colors, radii, row } from '@/theme/tokens';

export function ProjectHeader({ instance, workspaces, current, title }: { instance: string | null; workspaces: readonly TreeWorkspace[]; current?: TreeWorkspace | null; title?: string }) {
  const openDrawer = useOpenDrawer();
  const choose = useProjectStore((state) => state.choose);
  const [open, setOpen] = useState(false);
  return (
    <XStack alignItems="center" paddingHorizontal="$2" height={52} gap="$1">
      <IconButton as={Menu} label="Open sessions" onPress={openDrawer} />
      {title ? (
        <Text color={colors.text} fontSize={16} fontWeight="700" flex={1} numberOfLines={1}>{title}</Text>
      ) : (
        <>
          <Tap role="button" accessibilityLabel="Choose project" disabled={workspaces.length < 2} onPress={() => setOpen(true)}>
            <XStack alignItems="center" gap="$1.5" paddingHorizontal="$3" height={34} borderRadius={radii.pill} borderWidth={1} borderColor={colors.border} backgroundColor={colors.surface}>
              <Text color={colors.text} fontSize={14} fontWeight="650" numberOfLines={1} maxWidth={220}>{current?.label ?? 'No workspace'}</Text>
              {workspaces.length > 1 ? <Icon as={ChevronDown} size="sm" tone="subtle" /> : null}
            </XStack>
          </Tap>
          <XStack flex={1} />
        </>
      )}
      <OptionSheet visible={open} title="Project" onClose={() => setOpen(false)}>
        {workspaces.map((workspace) => (
          <Tap
            key={workspace.id}
            role="button"
            accessibilityLabel={workspace.label}
            onPress={() => {
              if (instance) choose(instance, workspace.id);
              setOpen(false);
            }}>
            <XStack alignItems="center" gap={row.gap} paddingHorizontal="$4" minHeight={48}>
              <Text flex={1} color={colors.text} fontSize={15} fontWeight={workspace.id === current?.id ? '700' : '500'} numberOfLines={1}>{workspace.label}</Text>
              {workspace.id === current?.id ? <Icon as={Check} size="sm" tone="accent" /> : null}
            </XStack>
          </Tap>
        ))}
      </OptionSheet>
    </XStack>
  );
}
