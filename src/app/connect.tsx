// [INPUT]: a pasted solco://pair link, or the stored connection when already paired.
// [OUTPUT]: ConnectScreen — the phone's list of paired Macs (cards: live status, address, route,
//           last connected, switch / reconnect / forget) and the way to pair another one by scanning
//           or pasting the link the Mac shows (Settings → Remote Access → Pair a phone → Copy Link), plus the Android-only KeepAliveCard (alerts while backgrounded).
// [POS]: The manual twin of the deep-link route. The Mac stays the authority: the list is only what
//        this phone paired (kept by lib/host-book), there is no token field and no transport
//        preference — a link carries the host, the port, the certificate fingerprint and a
//        single-use code.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { useQueryClient } from '@tanstack/react-query';
import { Cable, ScanLine } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Input, ScrollView, Text, XStack, YStack } from 'tamagui';

import { HostCard } from '@/components/host-card';
import { Icon } from '@/components/icon';
import { Reveal } from '@/components/motion';
import { PillButton } from '@/components/pill-button';
import { Card, SectionLabel } from '@/components/section';
import { KeepAliveCard } from '@/components/keep-alive-card';
import { describeConnectFailure } from '@/features/host/connect-failure';
import { useHostProbes } from '@/features/host/queries-v3';
import { hostId } from '@/lib/host-book';
import { useHostV3 } from '@/lib/host-v3-provider';
import { readPhoneNetwork } from '@/lib/phone-network';
import { useNow } from '@/lib/use-now';
import { parsePairUrl } from '@/lib/pairing-v3';
import { colors, radii, spacing } from '@/theme/tokens';

export default function ConnectScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { hosts, activeId, pair, switchTo, remove, pinnedAvailable } = useHostV3();
  const probes = useHostProbes(true);
  const now = useNow();
  const [link, setLink] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const target = parsePairUrl(link);
    if (!target) {
      setError('That is not a Solco pairing link. It starts with solco://pair?…');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await pair(target);
      setLink('');
      router.replace('/');
    } catch (cause) {
      const view = describeConnectFailure(cause, { host: target.host, port: target.port, network: await readPhoneNetwork() });
      setError(`${view.title} (${view.detail}). ${view.hint}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }} edges={['bottom']}>
      <ScrollView flex={1} contentContainerStyle={{ paddingHorizontal: spacing.screen, paddingVertical: spacing.section, gap: spacing.section }}>
        <YStack gap="$2">
          <XStack alignItems="center" gap="$2">
            <Icon as={Cable} tone="accent" />
            <Text color={colors.text} fontSize={22} fontWeight="800" letterSpacing={-0.4}>Connect to your computer</Text>
          </XStack>
          {hosts.length === 0 ? (
            <YStack gap="$1">
              <Text color={colors.textMuted} fontSize={13} lineHeight={20}>1. Computer: Solco → Settings → Remote Access → turn on.</Text>
              <Text color={colors.textMuted} fontSize={13} lineHeight={20}>2. Phone and computer on the same Wi-Fi, or both on Tailscale.</Text>
              <Text color={colors.textMuted} fontSize={13} lineHeight={20}>3. Pair a phone → scan the QR code below.</Text>
            </YStack>
          ) : (
            <Text color={colors.textMuted} fontSize={13} lineHeight={20}>Computer: Solco → Settings → Remote Access → Pair a phone.</Text>
          )}
        </YStack>

        {hosts.length > 0 ? (
          <YStack gap="$3">
            <SectionLabel inset={false}>Your computers</SectionLabel>
            {hosts.map((record) => {
              const id = hostId(record);
              const active = id === activeId;
              return (
                <Reveal key={id}>
                <HostCard
                  record={record}
                  active={active}
                  probe={probes[id] ?? 'checking'}
                  now={now}
                  onSwitch={() => void switchTo(id).then(() => router.replace('/'))}
                  onReconnect={() => {
                    void queryClient.invalidateQueries({ queryKey: ['v3'] });
                    router.replace('/');
                  }}
                  onRemove={() => void remove(id)}
                />
                </Reveal>
              );
            })}
          </YStack>
        ) : null}

        {!pinnedAvailable ? (
          <Text color={colors.attention} fontSize={13} lineHeight={19}>
            Pairing requires the Android app.
          </Text>
        ) : (
          <Card padded gap={12}>
            <PillButton fill icon={ScanLine} label="Scan QR code" onPress={() => router.push('/scan')} />
            <SectionLabel inset={false}>Or paste the link</SectionLabel>
            <Input
              value={link}
              onChangeText={setLink}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="solco://pair?h=…"
              placeholderTextColor="$placeholderColor"
              backgroundColor={colors.surfaceRaised}
              borderColor={colors.border}
              color={colors.text}
              borderRadius={radii.md}
            />
            {error ? <Text color={colors.danger} fontSize={13} lineHeight={19}>{error}</Text> : null}
            <PillButton
              fill
              label={submitting ? 'Pairing…' : hosts.length > 0 ? 'Pair another computer' : 'Pair'}
              accessibilityLabel="Pair"
              disabled={submitting || !link.trim()}
              onPress={() => void submit()}
            />
          </Card>
        )}
        <KeepAliveCard />
      </ScrollView>
    </SafeAreaView>
  );
}
