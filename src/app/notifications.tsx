// [INPUT]: nothing of its own: the two cards read the OS permission state, the battery-optimization state and the Host's push capability.
// [OUTPUT]: NotificationsScreen — the Settings → Notifications page: the Android keep-alive card (alerts while backgrounded) and the
//           system-push card (an owner-controlled remote opt-in), unchanged.
// [POS]: Where "Push and keep-alive move here from Connection settings" (designs/mobile-t3-redesign `settings`): the two cards left
//        the Hosts page so it only lists computers. Each card renders nothing where its platform has no such thing.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { ScrollView } from 'react-native';

import { KeepAliveCard } from '@/components/keep-alive-card';
import { Screen } from '@/components/screen';
import { SystemPushCard } from '@/components/system-push-card';
import { spacing } from '@/theme/tokens';

export default function NotificationsScreen() {
  return (
    <Screen back title="Notifications">
      <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.screen, paddingTop: spacing.firstSection, paddingBottom: 24, gap: spacing.card }}>
        <KeepAliveCard />
        <SystemPushCard />
      </ScrollView>
    </Screen>
  );
}
