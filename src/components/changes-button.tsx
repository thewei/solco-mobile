// [INPUT]: the Host's `capabilities.git`, the tree, and the pane (or terminal) the screen shows.
// [OUTPUT]: ChangesButton — the header icon that opens that pane's Workspace Changes view; renders nothing without the capability or a known Workspace.
// [POS]: Entry point of the read-only Git view from Chat and Terminal. Client-local navigation only.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { GitCompare } from 'lucide-react-native';
import { useRouter } from 'expo-router';

import { IconButton } from '@/components/icon-button';
import { workspaceOfPane, workspaceOfTerminal } from '@/features/host/git-model';
import { useHostInstance, useTreeV3 } from '@/features/host/queries-v3';

export function ChangesButton({ instance, paneId, terminalId }: { instance: string; paneId?: string; terminalId?: string }) {
  const router = useRouter();
  const { bootstrap } = useHostInstance();
  const tree = useTreeV3(instance || null);
  if (bootstrap.data?.capabilities.git !== true) return null;
  const workspaces = tree.data?.workspaces ?? [];
  const workspace = (paneId ? workspaceOfPane(workspaces, paneId) : null) ?? (terminalId ? workspaceOfTerminal(workspaces, terminalId) : null);
  if (!workspace) return null;
  return (
    <IconButton
      as={GitCompare}
      tone="muted"
      label="Changes"
      onPress={() => router.push({ pathname: '/changes/[workspaceId]', params: { workspaceId: workspace.id, instance, title: workspace.label } })}
    />
  );
}
