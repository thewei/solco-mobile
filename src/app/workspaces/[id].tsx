// [INPUT]: a Workspace id from the tree, the Host's capabilities and (for the Changes row) the Workspace's Git status.
// [OUTPUT]: WorkspaceScreen — one Workspace: Files, Changes (branch · N files) and Terminal rows, then `Chats in this workspace`
//           (cards for what is active, one-line rows for what settled) and a dashed "New chat in <workspace>" button. A row whose
//           capability the Host does not advertise is not drawn.
// [POS]: The second door to a Workspace's tools beside a chat's top bar (designs/mobile-t3-redesign `workspace`): they open even when
//        no chat is running. Terminal opens the Workspace's own plain terminal pane (else its first pane); the rest is navigation only.
// [PROTOCOL]: 变更时更新此头部，然后检查 ../CLAUDE.md
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScrollView } from 'react-native';

import { EmptyState } from '@/components/empty-state';
import { ListRow, MoreButton, Section, Shelf } from '@/components/list-group';
import { Screen } from '@/components/screen';
import { ListSkeleton } from '@/components/skeletons';
import { ThreadRow } from '@/components/thread-row';
import { agentAge, agoShort, comparePanes, flattenPanes, paneRoute, paneTitle, reportsAges } from '@/features/host/pane-model';
import { useGitStatus, useHostInstance, useTreeV3 } from '@/features/host/queries-v3';
import { useHostV3 } from '@/lib/host-v3-provider';
import { useNow } from '@/lib/use-now';
import { IconFolder, IconFolders, IconGitBranch, IconTerminal2 } from '@/theme/glyphs';

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

export default function WorkspaceScreen() {
  const router = useRouter();
  const id = first(useLocalSearchParams<{ id: string }>().id);
  const { connection } = useHostV3();
  const { bootstrap, instance } = useHostInstance();
  const tree = useTreeV3(instance);
  const now = useNow();
  const caps = bootstrap.data?.capabilities;
  const workspace = tree.data?.workspaces.find((item) => item.id === id);
  const git = useGitStatus(instance, id, caps?.git === true && workspace !== undefined);
  const hostName = connection?.name || bootstrap.data?.hostName || 'Solco';

  if (tree.isLoading) {
    return (
      <Screen back title="Workspace" subtitle={hostName}>
        <ListSkeleton rows={4} inset />
      </Screen>
    );
  }
  if (!workspace || !instance) {
    return (
      <Screen back title="Workspace" subtitle={hostName}>
        <EmptyState icon={IconFolders} title="Workspace not found" text={`It is no longer open on ${hostName}.`} action="All workspaces" onAction={() => router.replace('/workspaces')} />
      </Screen>
    );
  }

  const panes = flattenPanes([workspace]);
  const chats = panes.filter((item) => item.pane.agent).sort((a, b) => comparePanes(a.pane, b.pane));
  // Judged over the whole tree: one Workspace alone cannot tell "the Host reports no times" from "this chat never ran".
  const agesKnown = reportsAges(flattenPanes(tree.data?.workspaces ?? []));
  const terminal = panes.find((item) => !item.pane.agent) ?? panes[0];
  const params = { workspaceId: workspace.id, instance, title: workspace.label };
  const changed = git.data?.repo ? git.data.files.length : undefined;
  const changesDetail = git.data?.repo ? [git.data.branch, changed === undefined ? undefined : `${changed} ${changed === 1 ? 'file' : 'files'}`].filter(Boolean).join(' · ') : undefined;
  const chatServed = caps?.chat === true;
  const tools = [caps?.files, caps?.git, caps?.terminal && terminal].some(Boolean);

  return (
    <Screen back title={workspace.label} subtitle={hostName}>
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        {tools ? (
          <Section first>
            {caps?.files ? <ListRow icon={IconFolder} label="Files" onPress={() => router.push({ pathname: '/files/[workspaceId]', params })} /> : null}
            {caps?.git ? <ListRow icon={IconGitBranch} label="Changes" detail={changesDetail} onPress={() => router.push({ pathname: '/changes/[workspaceId]', params })} /> : null}
            {caps?.terminal && terminal ? (
              <ListRow icon={IconTerminal2} label="Terminal" onPress={() => router.push({ pathname: '/terminal/[terminalId]', params: { terminalId: terminal.pane.terminalId, instance, title: workspace.label } })} />
            ) : null}
          </Section>
        ) : null}
        {chats.length > 0 ? <Shelf label="Chats in this workspace" after={tools ? 'section' : undefined} /> : null}
        {chats.map((item) => {
          const status = item.pane.agent?.status === 'blocked' ? 'needs' : item.pane.agent?.status === 'working' ? 'working' : undefined;
          return (
            <ThreadRow
              key={item.pane.paneId}
              slim={status === undefined}
              workspace={workspace.label}
              title={paneTitle(item.pane)}
              status={status}
              statusExtra={status === 'working' ? agoShort(item.pane.agent?.lastActiveMs, now) : undefined}
              time={status === undefined ? agentAge(item.pane, now, agesKnown) : undefined}
              host={status === undefined ? undefined : hostName}
              provider={status === undefined ? undefined : item.pane.agent?.provider}
              onPress={() => router.push(paneRoute(item.pane, instance, chatServed))}
            />
          );
        })}
        {caps?.launch ? <MoreButton label={`New chat in ${workspace.label}`} onPress={() => router.push({ pathname: '/compose', params: { instance, workspaceId: workspace.id } })} /> : null}
      </ScrollView>
    </Screen>
  );
}
