// [INPUT]: the sessions drawer content and the Home screen.
// [OUTPUT]: the Home drawer navigator — push-style (the main layer slides right), edge-swipe to open.
// [POS]: Option C of designs/mobile-shell. `(home)` is a route group, so Home is still `/`.
//        Expo Router's own Drawer owns the gesture and animation; nothing here is hand-rolled.
// [PROTOCOL]: 变更时更新此头部，然后检查 ../CLAUDE.md
import { Drawer } from 'expo-router/drawer';

import { SessionsDrawer } from '@/components/sessions-drawer';
import { colors } from '@/theme/tokens';

export default function HomeLayout() {
  return (
    <Drawer
      drawerContent={(props) => <SessionsDrawer navigation={props.navigation} />}
      screenOptions={{
        headerShown: false,
        drawerType: 'slide',
        drawerStyle: { width: 304, backgroundColor: colors.canvas },
        overlayColor: 'rgba(0,0,0,0.45)',
        sceneStyle: { backgroundColor: colors.canvas },
      }}
    />
  );
}
