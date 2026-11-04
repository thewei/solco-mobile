// [INPUT]: the chosen project (useProject) and the Host's read-only Git status for its folder.
// [OUTPUT]: The Changes tab: the project head over the shared ChangesView; a row opens that file's diff.
// [POS]: Projection of the desktop's Changes view. Read-only; the project choice is client-local.
// [PROTOCOL]: 变更时更新此头部，然后检查 ../../CLAUDE.md
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text, YStack } from 'tamagui';

import { ChangesView } from '@/components/changes-view';
import { ProjectHeader } from '@/components/project-header';
import { useProject } from '@/features/host/use-project';
import { colors } from '@/theme/tokens';

export default function ChangesTab() {
  const { instance, workspaces, current } = useProject();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }} edges={['top']}>
      <ProjectHeader instance={instance} workspaces={workspaces} current={current} />
      {current ? (
        <ChangesView key={current.id} instance={instance} workspaceId={current.id} />
      ) : (
        <YStack flex={1} alignItems="center" justifyContent="center"><Text color={colors.textMuted} fontSize={13}>No workspace yet.</Text></YStack>
      )}
    </SafeAreaView>
  );
}
