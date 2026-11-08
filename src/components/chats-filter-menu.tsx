// [INPUT]: visibility, the Workspaces of the Mac the phone is looking at, the chosen Workspace (undefined = all) and handlers.
// [OUTPUT]: ChatsFilterMenu — the Chats filter popover: a main view with Host › and Workspace ›, and the two submenus
//           (a back row, then check rows). Host switches where the phone is looking (HostChoices); Workspace narrows the list.
// [POS]: The popover under the Chats bar's filter button (designs/mobile-t3-redesign `chats-filter`). The filter button
//        shows its filled glyph while a Workspace is chosen. The menu always opens on its main view.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { useEffect, useState } from 'react';

import { HostChoices } from '@/components/host-choices';
import { Menu, MenuItem } from '@/components/menu';
import type { TreeWorkspace } from '@/contracts/host-v3';
import { IconChevronLeft, IconChevronRight } from '@/theme/glyphs';

type View = 'main' | 'host' | 'workspace';

export function ChatsFilterMenu({
  visible,
  onClose,
  workspaces,
  workspaceId,
  onWorkspace,
}: {
  visible: boolean;
  onClose: () => void;
  workspaces: readonly TreeWorkspace[];
  workspaceId: string | undefined;
  onWorkspace: (id: string | undefined) => void;
}) {
  const [view, setView] = useState<View>('main');
  useEffect(() => {
    if (visible) setView('main');
  }, [visible]);
  const pick = (id: string | undefined) => {
    onWorkspace(id);
    onClose();
  };
  return (
    <Menu visible={visible} onClose={onClose}>
      {view === 'main' ? (
        <>
          <MenuItem label="Host" trailing={IconChevronRight} onPress={() => setView('host')} />
          <MenuItem label="Workspace" trailing={IconChevronRight} onPress={() => setView('workspace')} />
        </>
      ) : null}
      {view === 'host' ? (
        <>
          <MenuItem muted leading={IconChevronLeft} label="Host" onPress={() => setView('main')} />
          <HostChoices onDone={onClose} />
        </>
      ) : null}
      {view === 'workspace' ? (
        <>
          <MenuItem muted leading={IconChevronLeft} label="Workspace" onPress={() => setView('main')} />
          <MenuItem label="All workspaces" checked={workspaceId === undefined} onPress={() => pick(undefined)} />
          {workspaces.map((workspace) => (
            <MenuItem key={workspace.id} label={workspace.label} checked={workspaceId === workspace.id} onPress={() => pick(workspace.id)} />
          ))}
        </>
      ) : null}
    </Menu>
  );
}
