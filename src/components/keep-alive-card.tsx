// [INPUT]: expo-notifications permission state and the native foreground-service battery helpers.
// [OUTPUT]: KeepAliveCard — Android-only Connect-screen card: allow notifications, send a 5 s test alert (same channel as agent alerts), skip battery
//           optimization, and the vivo/OriginOS whitelist steps that keep background delivery alive.
// [POS]: Pure UI over the keep-alive seam; renders null on Web/iOS. Both indicators re-read when
//        the app returns to the foreground (the settings dialogs resolve outside the app process).
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import * as Notifications from 'expo-notifications';
import { useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { Text } from 'tamagui';

import { ATTENTION_CHANNEL } from '@/features/host/attention';
import { PillButton } from '@/components/pill-button';
import { Card } from '@/components/section';
import { getForegroundService } from '@/lib/foreground-service-native';
import { colors } from '@/theme/tokens';

export function KeepAliveCard() {
  const [granted, setGranted] = useState<boolean | null>(null);
  const [exempt, setExempt] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    let cancelled = false;
    const refresh = async () => {
      const [permission, ignoring] = await Promise.all([
        Notifications.getPermissionsAsync()
          .then((state) => state.granted)
          .catch(() => false),
        Promise.resolve(getForegroundService()?.isIgnoringBatteryOptimizations() ?? false),
      ]);
      if (!cancelled) {
        setGranted(permission);
        setExempt(ignoring);
      }
    };
    void refresh();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);

  if (Platform.OS !== 'android') return null;

  return (
    <Card padded>
      <Text color={colors.text} fontSize={13} fontWeight="700">Alerts while backgrounded{granted && exempt ? ' · ready' : ''}</Text>
      <Text color={colors.textMuted} fontSize={12} lineHeight={18}>
        Allow notifications (turn on banner and lock-screen display in Solco notification settings),
        skip battery optimization, allow background high power and auto-start for Solco (vivo: 设置 → 电池 →
        后台高耗电管理; i管家 → 应用管理 → 权限管理), and lock Solco in the recents screen.
      </Text>
      <PillButton
        fill
        label={granted ? 'Notifications allowed' : 'Allow notifications'}
        accessibilityLabel="Allow notifications"
        disabled={granted === true}
        onPress={() => {
          void Notifications.requestPermissionsAsync().then((state) => setGranted(state.granted));
        }}
      />
      <PillButton
        fill
        tone="soft"
        label="Send a test alert in 5 s"
        accessibilityLabel="Send a test alert"
        disabled={granted !== true}
        onPress={() => {
          // Same channel as agent alerts: leave the app (or lock the phone) within 5 s to try the background path.
          void Notifications.scheduleNotificationAsync({
            content: { title: 'Solco test alert', body: 'If you can read this, agent alerts reach you.' },
            trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 5, channelId: ATTENTION_CHANNEL },
          });
        }}
      />
      <PillButton
        fill
        tone="soft"
        label={exempt ? 'Battery optimization skipped' : 'Skip battery optimization'}
        accessibilityLabel="Skip battery optimization"
        disabled={exempt}
        onPress={() => getForegroundService()?.openIgnoreBatteryOptimizations()}
      />
    </Card>
  );
}
