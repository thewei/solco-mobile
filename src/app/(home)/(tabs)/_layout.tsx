// [INPUT]: the Host's capabilities (which tabs exist) and the tree (the Chats badge).
// [OUTPUT]: the Home bottom tab bar — Chats · Sessions · Usage · Settings; a tab whose capability the Host does not
//           advertise is not drawn, and Chats carries the number of agents that need you.
// [POS]: The four tabs of the 2026-11-07 phone redesign (designs/mobile-t3-redesign). Changes and Files are no longer
//        tabs: they open from a chat's top bar or Settings → Workspaces → a workspace. Chat, terminal and the other
//        pushed screens cover the bar. Expo Router's own Tabs owns the behaviour; only the bar is drawn by
//        components/bottom-nav.
// [PROTOCOL]: 变更时更新此头部，然后检查 ../../CLAUDE.md
import { Tabs } from 'expo-router';

import { BottomNav } from '@/components/bottom-nav';
import { summarize } from '@/features/host/pane-model';
import { useHostInstance, useTreeV3 } from '@/features/host/queries-v3';
import { colors } from '@/theme/tokens';

export default function TabsLayout() {
  const { bootstrap, instance } = useHostInstance();
  const tree = useTreeV3(instance);
  const capabilities = bootstrap.data?.capabilities;
  const needsYou = summarize(tree.data?.workspaces ?? []).needsYou.length;
  const hidden = [capabilities?.sessions ? null : 'sessions', capabilities?.quota ? null : 'quota'].filter((name): name is string => name !== null);
  return (
    <Tabs
      tabBar={(props) => <BottomNav {...props} hidden={hidden} badge={needsYou} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.chrome } }}>
      <Tabs.Screen name="index" options={{ title: 'Chats' }} />
      <Tabs.Screen name="sessions" options={{ title: 'Sessions', href: capabilities?.sessions ? undefined : null }} />
      <Tabs.Screen name="quota" options={{ title: 'Usage', href: capabilities?.quota ? undefined : null }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
    </Tabs>
  );
}
