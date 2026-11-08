// [INPUT]: the tree of the Mac (and Herdr session) the phone is looking at.
// [OUTPUT]: WorkspacesScreen — the Settings → Workspaces page: a shelf named after the computer, then one slim row per Workspace
//           with its chat count; a row opens that Workspace's page. Loading, empty and unreadable are states of the page.
// [POS]: One of the only two doors to a Workspace's Files, Changes and Terminal (the other is a chat's top bar;
//        designs/mobile-t3-redesign `workspaces`). The draft lists every host under its own shelf; the phone reads one Mac at a
//        time, so there is one shelf — switch the computer from the Chats filter's Host menu.
// [PROTOCOL]: 变更时更新此头部，然后检查 ../CLAUDE.md
import { useRouter } from 'expo-router';
import { ScrollView } from 'react-native';

import { EmptyState } from '@/components/empty-state';
import { Shelf } from '@/components/list-group';
import { pullRefresh } from '@/components/pull-refresh';
import { Screen } from '@/components/screen';
import { ListSkeleton } from '@/components/skeletons';
import { ThreadRow } from '@/components/thread-row';
import { flattenPanes } from '@/features/host/pane-model';
import { useHostInstance, useTreeV3 } from '@/features/host/queries-v3';
import { useHostV3 } from '@/lib/host-v3-provider';
import { IconFolders } from '@/theme/glyphs';

export default function WorkspacesScreen() {
  const router = useRouter();
  const { connection } = useHostV3();
  const { bootstrap, instance } = useHostInstance();
  const tree = useTreeV3(instance);
  const hostName = connection?.name || bootstrap.data?.hostName || 'Solco';
  const workspaces = tree.data?.workspaces ?? [];

  let body: React.ReactNode;
  if (tree.isLoading) {
    body = <ListSkeleton shelf rows={4} inset />;
  } else if (!tree.data) {
    body = <EmptyState icon={IconFolders} title="Can’t read workspaces" text={`${hostName} did not answer. Check the host in Settings, then try again.`} action="Try again" onAction={() => void tree.refetch()} />;
  } else if (workspaces.length === 0) {
    body = <EmptyState icon={IconFolders} title="No workspaces yet" text={`Open a folder in Solco on ${hostName}.`} />;
  } else {
    body = (
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }} refreshControl={pullRefresh(tree.isRefetching, () => void tree.refetch())}>
        <Shelf label={hostName} />
        {workspaces.map((workspace) => {
          const chats = flattenPanes([workspace]).filter((item) => item.pane.agent).length;
          const count = `${chats} ${chats === 1 ? 'chat' : 'chats'}`;
          return (
            <ThreadRow
              key={workspace.id}
              slim
              workspace={workspace.label}
              title={workspace.label}
              time={count}
              accessibilityLabel={`${workspace.label}, ${hostName}, ${count}`}
              onPress={() => router.push({ pathname: '/workspaces/[id]', params: { id: workspace.id } })}
            />
          );
        })}
      </ScrollView>
    );
  }

  return (
    <Screen back title="Workspaces">
      {body}
    </Screen>
  );
}
