// [INPUT]: the screen's navigation object (a tab, a stack screen or the drawer itself).
// [OUTPUT]: useOpenDrawer — a function that opens the Home drawer from anywhere inside it.
// [POS]: Tab screens sit one navigator below the drawer, so their own navigation has no openDrawer; this walks up to the one that does.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { useNavigation } from 'expo-router';

interface MaybeDrawer {
  openDrawer?: () => void;
  getParent?: () => MaybeDrawer | undefined;
}

export function useOpenDrawer(): () => void {
  const navigation = useNavigation() as unknown as MaybeDrawer;
  return () => {
    for (let nav: MaybeDrawer | undefined = navigation; nav; nav = nav.getParent?.()) {
      if (nav.openDrawer) {
        nav.openDrawer();
        return;
      }
    }
  };
}
