// [INPUT]: the chosen Herdr session's tree and the client-local project choice (project-store).
// [OUTPUT]: useProject — { instance, workspaces, current } for the project-scoped tabs.
// [POS]: One answer to "which Workspace do Changes and Files show". Client-local; never the Mac's focus.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { pickWorkspace } from '@/features/host/project-model';
import { useHostInstance, useTreeV3 } from '@/features/host/queries-v3';
import { useProjectStore } from '@/state/project-store';

export function useProject() {
  const { instance } = useHostInstance();
  const tree = useTreeV3(instance);
  const chosen = useProjectStore((state) => (instance ? state.chosen[instance] : undefined));
  const workspaces = tree.data?.workspaces ?? [];
  return { instance, workspaces, current: pickWorkspace(workspaces, chosen), loading: tree.isLoading };
}
