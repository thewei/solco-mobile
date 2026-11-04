// [INPUT]: the chosen project (useProject) and the Host's read-only listing of its folder.
// [OUTPUT]: The Files tab: the project head over the shared FilesView at the project's root; deeper levels push `/files/[workspaceId]`.
// [POS]: Projection of the desktop's Files view. Read-only; "Attach to chat" lives on the file preview.
// [PROTOCOL]: 变更时更新此头部，然后检查 ../../CLAUDE.md
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text, YStack } from 'tamagui';

import { FilesView } from '@/components/files-view';
import { ProjectHeader } from '@/components/project-header';
import { useProject } from '@/features/host/use-project';
import { colors } from '@/theme/tokens';

export default function FilesTab() {
  const { instance, workspaces, current } = useProject();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }} edges={['top']}>
      <ProjectHeader instance={instance} workspaces={workspaces} current={current} />
      {current ? (
        <FilesView key={current.id} instance={instance} workspaceId={current.id} title={current.label} dir="" />
      ) : (
        <YStack flex={1} alignItems="center" justifyContent="center"><Text color={colors.textMuted} fontSize={13}>No workspace yet.</Text></YStack>
      )}
    </SafeAreaView>
  );
}
