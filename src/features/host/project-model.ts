// [INPUT]: the tree's Workspaces and the Workspace the user chose on this phone (or none).
// [OUTPUT]: pickWorkspace — the Workspace the scoped tabs (Changes, Files) show.
// [POS]: The phone's "project head": client-local, never the Mac's focus. The user's choice wins while that
//        Workspace still exists; else the first Workspace that needs the user or is working; else the first.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import type { TreeWorkspace } from '@/contracts/host-v3';

export function pickWorkspace(workspaces: readonly TreeWorkspace[], chosenId: string | null | undefined): TreeWorkspace | null {
  if (workspaces.length === 0) return null;
  const chosen = chosenId ? workspaces.find((workspace) => workspace.id === chosenId) : undefined;
  if (chosen) return chosen;
  return workspaces.find((workspace) => workspace.status === 'blocked') ?? workspaces.find((workspace) => workspace.status === 'working') ?? workspaces[0] ?? null;
}
