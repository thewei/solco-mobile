// [INPUT]: a workspace id (+ instance, title, dir) — a folder pushed from the Files tab or a Chat's ⋯ menu.
// [OUTPUT]: Files screen: the shared FilesView for that level under a native stack header.
// [POS]: Pushed read-only folder level; the Files tab shows the project's root with the same body.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { Stack, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FilesView } from '@/components/files-view';
import { baseName } from '@/features/host/files-model';
import { useHostInstance } from '@/features/host/queries-v3';
import { colors } from '@/theme/tokens';

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

export default function FilesScreen() {
  const params = useLocalSearchParams<{ workspaceId: string; instance?: string; title?: string; dir?: string }>();
  const workspaceId = first(params.workspaceId);
  const dir = first(params.dir);
  const title = first(params.title);
  const { instance: defaultInstance } = useHostInstance();
  const instance = first(params.instance) || defaultInstance;
  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: dir ? baseName(dir) : title || 'Files', headerBackTitle: 'Back' }} />
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }} edges={['bottom']}>
        <FilesView instance={instance} workspaceId={workspaceId} title={title} dir={dir} />
      </SafeAreaView>
    </>
  );
}
