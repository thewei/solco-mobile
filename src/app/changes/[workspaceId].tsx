// [INPUT]: a workspace id (+ instance, title) — reached from Chat's ⋯ menu and Terminal's Changes button.
// [OUTPUT]: Changes screen: the shared ChangesView under a native stack header.
// [POS]: Pushed read-only Git view; the Changes tab shows the same body for the chosen project.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { Stack, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ChangesView } from '@/components/changes-view';
import { useHostInstance } from '@/features/host/queries-v3';
import { colors } from '@/theme/tokens';

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

export default function ChangesScreen() {
  const params = useLocalSearchParams<{ workspaceId: string; instance?: string; title?: string }>();
  const workspaceId = first(params.workspaceId);
  const { instance: defaultInstance } = useHostInstance();
  const instance = first(params.instance) || defaultInstance;
  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: first(params.title) || 'Changes', headerBackTitle: 'Back' }} />
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }} edges={['bottom']}>
        <ChangesView instance={instance} workspaceId={workspaceId} />
      </SafeAreaView>
    </>
  );
}
