// [INPUT]: a paired Host + its system-push capability, explicit Android permission and Expo project configuration
// [OUTPUT]: owner-controlled remote OS push opt-in / opt-out and truthful readiness hints
// [POS]: Connection settings; local foreground-service alerts remain independent.
import * as Notifications from 'expo-notifications';
import { useEffect, useState } from 'react';
import { Alert, AppState, Platform } from 'react-native';
import { Text, YStack } from 'tamagui';

import { PillButton } from '@/components/pill-button';
import { Card } from '@/components/section';
import { useBootstrapV3 } from '@/features/host/queries-v3';
import { useHostV3 } from '@/lib/host-v3-provider';
import { expoProjectId } from '@/lib/expo-push-config';
import { colors } from '@/theme/tokens';

export function SystemPushCard() {
  const { client, activeId } = useHostV3();
  const bootstrap = useBootstrapV3();
  const served = bootstrap.data?.capabilities.assistantSystemPush === true;
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const projectId = expoProjectId();

  useEffect(() => {
    if (Platform.OS !== 'android' || !client || !served) return undefined;
    let current = true;
    setEnabled(null);
    setError('');
    const refresh = () => {
      void client.systemPushStatus().then((status) => {
        if (current) setEnabled(status.enabled);
      }).catch(() => {
        if (current) setError('Cannot read background push status from this Mac.');
      });
    };
    refresh();
    const sub = AppState.addEventListener('change', (state) => { if (state === 'active') refresh(); });
    return () => { current = false; sub.remove(); };
  }, [client, activeId, served]);

  if (Platform.OS !== 'android' || !client || !served) return null;

  const enable = async () => {
    if (!projectId || busy) return;
    setBusy(true);setError('');
    try {
      const permission = await Notifications.getPermissionsAsync();
      const allowed = permission.granted ? permission : await Notifications.requestPermissionsAsync();
      if (!allowed.granted) throw new Error('Allow notifications for Solco in Android settings first.');
      const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
      const answer = await client.registerSystemPush(token);
      setEnabled(answer.enabled);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to register system push.');
    } finally { setBusy(false); }
  };
  const sendTest = async () => {
    if (busy || !enabled) return;
    setBusy(true); setError('');
    try {
      const queued = await client.testSystemPush();
      if (queued) Alert.alert('Test push queued', 'Expo accepted the test notification. Lock your phone to check Android delivery; receipt and phone display are separate.');
    } catch {
      setError('Could not send a system push test. Check FCM credentials and Mac connectivity.');
    } finally { setBusy(false); }
  };
  const disable = async () => {
    if (busy) return;
    setBusy(true);setError('');
    try {
      const answer = await client.disableSystemPush();
      setEnabled(answer.enabled);
    } catch {
      setError('Could not turn off system push on this Mac. Try again while connected.');
    } finally { setBusy(false); }
  };

  return (
    <Card padded gap={10}>
      <YStack gap={5}>
        <Text color={colors.text} fontSize={13} fontWeight="700">
          System push when app is closed{enabled ? ' · enabled' : ''}
        </Text>
        <Text color={colors.textMuted} fontSize={12} lineHeight={18}>
          When your phone is offline from Solco, the Mac can notify it through Expo and Google FCM.
          Lock-screen text contains only generic status, never prompts or project names.
          The Mac must be running and online.
        </Text>
        {!projectId ? (
          <Text color={colors.attention} fontSize={12} lineHeight={18}>
            This build has no Expo project ID. Configure an EAS project and Android FCM v1 credentials, then rebuild.
            Local and keep-alive notifications still work.
          </Text>
        ) : null}
        {error ? <Text color={colors.danger} fontSize={12}>{error}</Text> : null}
      </YStack>
      <PillButton
        fill
        label={busy ? 'Updating…' : enabled ? 'Disable system push' : enabled === null ? 'Checking push status…' : 'Enable system push'}
        disabled={busy || enabled === null || (!enabled && !projectId)}
        onPress={() => void (enabled ? disable() : enable())}
        tone={enabled ? 'soft' : 'primary'}
      />
      {enabled ? (
        <PillButton fill tone="soft" label="Send a system push test"
          disabled={busy} onPress={() => void sendTest()} />
      ) : null}
    </Card>
  );
}
