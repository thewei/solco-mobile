// [INPUT]: the paired Mac's Remote Desktop readiness (`GET /remote-desktop`) and the user's choices.
// [OUTPUT]: The Remote Desktop session route (opened from the device list): a lobby (state of the Mac, Control | View only, quality, Connect) that
//           becomes the full-bleed session screen once the Mac approves.
// [POS]: Entered from the device list (`/desktop`) once the chosen Mac is online and advertises `capabilities.remoteDesktop`. One session at a time;
//        the Mac's user approves each request (unless they switched approval off), may downgrade Control to
//        View only, and can end it from the Mac. Navigation stays client-local.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { useFocusEffect, useRouter } from 'expo-router';
import { ArrowLeft, Eye, MousePointerClick } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScrollView, Text, XStack, YStack } from 'tamagui';

import { Icon } from '@/components/icon';
import { IconButton } from '@/components/icon-button';
import { PillButton } from '@/components/pill-button';
import { RemoteLive } from '@/components/remote-desktop/remote-live';
import { Card } from '@/components/section';
import { Tap } from '@/components/tap';
import type { RdInfo, RdMode, RdTier } from '@/contracts/host-v3';
import { useHostInstance, useRemoteDesktopInfo } from '@/features/host/queries-v3';
import { TIER_LABEL } from '@/features/remote-desktop/quality';
import { useRemoteDesktop } from '@/features/remote-desktop/use-remote-desktop';
import { colors, radii } from '@/theme/tokens';

const STATE_COPY: Record<RdInfo['state'], { title: string; body: string; tone: 'success' | 'attention' }> = {
  ready: { title: 'Ready', body: 'Your Mac will ask for approval when you connect.', tone: 'success' },
  disabled: { title: 'Off on the Mac', body: 'Turn on Remote Desktop in Solco ▸ Settings ▸ Remote Desktop.', tone: 'attention' },
  permission_required: { title: 'Needs a permission', body: 'Allow Screen Recording for Solco in System Settings ▸ Privacy & Security, then reopen this screen.', tone: 'attention' },
  busy: { title: 'In use', body: 'The Mac’s screen is in use. If that is this phone’s earlier session, connecting takes it over.', tone: 'attention' },
  unavailable: { title: 'Unavailable', body: 'This Mac cannot share its screen right now.', tone: 'attention' },
};

function Choice({ icon, title, hint, selected, onPress }: { icon: typeof Eye; title: string; hint: string; selected: boolean; onPress: () => void }) {
  return (
    <Tap flex={1} role="button" accessibilityLabel={title} onPress={onPress} padding="$3" gap="$1.5" borderRadius={radii.md} borderWidth={1} borderColor={selected ? colors.accent : colors.border} backgroundColor={selected ? colors.accentSoft : colors.surface}>
      <Icon as={icon} tone={selected ? 'accent' : 'muted'} />
      <Text color={selected ? colors.accent : colors.text} fontSize={14} fontWeight="650">{title}</Text>
      <Text color={colors.textMuted} fontSize={12}>{hint}</Text>
    </Tap>
  );
}

export default function DesktopSessionScreen() {
  const router = useRouter();
  const { bootstrap } = useHostInstance();
  const supported = bootstrap.data?.capabilities.remoteDesktop === true;
  const info = useRemoteDesktopInfo(supported);
  const { session, snap, supported: webrtc, start, end } = useRemoteDesktop();
  const [mode, setMode] = useState<RdMode>('full');
  const [tier, setTier] = useState<RdTier>('standard');

  // Coming back to the lobby (e.g. after the Mac ended it) re-reads readiness.
  useFocusEffect(
    useCallback(() => {
      if (supported) void info.refetch();
    }, [supported]), // eslint-disable-line react-hooks/exhaustive-deps
  );

  if (snap.status === 'connecting' || snap.status === 'live') {
    return <RemoteLive session={session} snap={snap} onEnd={end} />;
  }

  const state = info.data?.state;
  const copy = state ? STATE_COPY[state] : null;
  const needsAccessibility = info.data && !info.data.permissions.accessibility;
  const requesting = snap.status === 'requesting';
  // `busy` still connects: the Mac hands a phone's own stale session over, and refuses any other phone by name
  const canConnect = webrtc && (state === 'ready' || state === 'busy') && !requesting;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }} edges={['top', 'bottom']}>
      <XStack alignItems="center" paddingHorizontal="$2" height={52}>
        <IconButton as={ArrowLeft} label="Back" onPress={() => router.back()} />
        <Text color={colors.text} fontSize={17} fontWeight="700" marginLeft="$1">Remote Desktop</Text>
      </XStack>
      <ScrollView contentContainerStyle={{ padding: 18, gap: 16 }}>
        {bootstrap.isPending ? (
          <XStack gap="$2" alignItems="center">
            <ActivityIndicator color={colors.textMuted} />
            <Text color={colors.textMuted} fontSize={13}>Connecting to your Mac…</Text>
          </XStack>
        ) : !supported ? (
          <Card>
            <YStack padding="$4" gap="$1.5">
              <Text color={colors.text} fontSize={15} fontWeight="650">Not available</Text>
              <Text color={colors.textMuted} fontSize={13}>This Mac’s Solco does not offer Remote Desktop yet. Update Solco on the Mac.</Text>
            </YStack>
          </Card>
        ) : (
          <>
            <Card>
              <YStack padding="$4" gap="$1.5">
                {info.isPending ? (
                  <XStack gap="$2" alignItems="center">
                    <ActivityIndicator color={colors.textMuted} />
                    <Text color={colors.textMuted} fontSize={13}>Checking your Mac…</Text>
                  </XStack>
                ) : copy ? (
                  <>
                    <Text color={copy.tone === 'success' ? colors.success : colors.attention} fontSize={13} fontWeight="700">{copy.title}</Text>
                    <Text color={colors.textMuted} fontSize={13} lineHeight={19}>{copy.body}</Text>
                  </>
                ) : (
                  <Text color={colors.textMuted} fontSize={13}>Could not read this Mac’s Remote Desktop state.</Text>
                )}
              </YStack>
            </Card>

            <XStack gap="$3">
              <Choice icon={MousePointerClick} title="Control" hint="Click, type, scroll" selected={mode === 'full'} onPress={() => setMode('full')} />
              <Choice icon={Eye} title="View only" hint="Watch, no input" selected={mode === 'view'} onPress={() => setMode('view')} />
            </XStack>
            {mode === 'full' && needsAccessibility ? (
              <Text color={colors.attention} fontSize={12} lineHeight={18}>Control needs the Accessibility permission for Solco on the Mac. Until it is allowed, the session starts as View only.</Text>
            ) : null}

            <YStack gap="$2">
              <Text color={colors.textSubtle} fontSize={11} fontWeight="700" letterSpacing={0.6}>QUALITY</Text>
              <XStack gap="$2">
                {(info.data?.tiers ?? (['smooth', 'standard', 'high'] as RdTier[])).map((t) => (
                  <Tap key={t} flex={1} role="button" accessibilityLabel={TIER_LABEL[t].title} onPress={() => setTier(t)} paddingVertical="$2.5" alignItems="center" borderRadius={radii.md} borderWidth={1} borderColor={tier === t ? colors.accent : colors.border} backgroundColor={tier === t ? colors.accentSoft : colors.surface}>
                    <Text color={tier === t ? colors.accent : colors.text} fontSize={13} fontWeight="650">{TIER_LABEL[t].title}</Text>
                  </Tap>
                ))}
              </XStack>
              <Text color={colors.textMuted} fontSize={12}>{TIER_LABEL[tier].hint}</Text>
            </YStack>

            {!webrtc ? <Text color={colors.danger} fontSize={13}>This build of the app has no WebRTC support.</Text> : null}
            {snap.status === 'failed' && snap.error ? <Text color={colors.danger} fontSize={13} lineHeight={19}>{snap.error.message}</Text> : null}
            {snap.status === 'ended' ? <Text color={colors.textMuted} fontSize={13}>The session ended.</Text> : null}

            {requesting ? (
              <YStack gap="$3" alignItems="center">
                <XStack gap="$2" alignItems="center">
                  <ActivityIndicator color={colors.textMuted} />
                  <Text color={colors.textMuted} fontSize={13}>Waiting for approval on your Mac…</Text>
                </XStack>
                <PillButton tone="soft" label="Cancel" onPress={end} />
              </YStack>
            ) : (
              <PillButton label="Connect" fill disabled={!canConnect} onPress={() => void start(mode, tier)} />
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
