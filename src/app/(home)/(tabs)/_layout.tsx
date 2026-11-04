// [INPUT]: the Host's capabilities (which tabs exist) and the tree (the Agents badge).
// [OUTPUT]: the Home bottom tab bar — Agents · Changes · Files · Sessions · Quota; a tab whose capability the Host does not
//           advertise is hidden, and the Agents tab carries the number of agents that need you.
// [POS]: Nav A of designs/mobile-projection: the desktop's view tabs on the phone. Agents is cross-project; Changes and
//        Files share the project head. Tabs sit inside the Home drawer; chat, terminal and the other pushed screens
//        cover the bar. Expo Router's own Tabs owns the behaviour — nothing is hand-rolled.
// [PROTOCOL]: 变更时更新此头部，然后检查 ../../CLAUDE.md
import { Bot, Folder, Gauge, GitCompare, History, type LucideIcon } from 'lucide-react-native';
import { Tabs } from 'expo-router';

import { summarize } from '@/features/host/pane-model';
import { useHostInstance, useTreeV3 } from '@/features/host/queries-v3';
import { colors, icons } from '@/theme/tokens';

const icon = (Glyph: LucideIcon) =>
  function TabIcon({ color, size }: { color: string; size: number }) {
    return <Glyph color={color} size={size} strokeWidth={icons.stroke} absoluteStrokeWidth />;
  };

export default function TabsLayout() {
  const { bootstrap, instance } = useHostInstance();
  const tree = useTreeV3(instance);
  const capabilities = bootstrap.data?.capabilities;
  const needsYou = summarize(tree.data?.workspaces ?? []).needsYou.length;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: { backgroundColor: colors.canvas, borderTopColor: colors.border },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        sceneStyle: { backgroundColor: colors.canvas },
      }}>
      <Tabs.Screen name="index" options={{ title: 'Agents', tabBarIcon: icon(Bot), tabBarBadge: needsYou > 0 ? needsYou : undefined }} />
      <Tabs.Screen name="changes" options={{ title: 'Changes', tabBarIcon: icon(GitCompare), href: capabilities?.git ? undefined : null }} />
      <Tabs.Screen name="files" options={{ title: 'Files', tabBarIcon: icon(Folder), href: capabilities?.files ? undefined : null }} />
      <Tabs.Screen name="sessions" options={{ title: 'Sessions', tabBarIcon: icon(History), href: capabilities?.sessions ? undefined : null }} />
      <Tabs.Screen name="quota" options={{ title: 'Quota', tabBarIcon: icon(Gauge), href: capabilities?.quota ? undefined : null }} />
    </Tabs>
  );
}
