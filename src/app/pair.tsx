// [INPUT]: solco://pair?h=&p=&fp=&c=&n=[&r=&rt=] deep link (the Mac's pairing QR, opened by the
//          system camera or any link) as expo-router params; `r`/`rt` name an optional relay the
//          pair request goes through (POST <r>/c/<rt>/api/v3/pair).
// [OUTPUT]: One pairing attempt — over the fingerprint-pinned channel, or through the link's
//           relay when it carries r/rt; success replaces to Home,
//           failure shows the Host's reason and an exit to the paste form.
// [POS]: Deep-link consumer only. It never displays, stores or logs the one-time code or the
//        fingerprint, and a malformed link is refused rather than repaired. A new link
//        arriving while this screen shows a failure pairs again (one attempt per code).
// [PROTOCOL]: 变更时更新此头部，然后检查 ../CLAUDE.md
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Spinner, Text, YStack } from 'tamagui';

import { Icon } from '@/components/icon';
import { Fade } from '@/components/motion';
import { PillButton } from '@/components/pill-button';
import { Screen } from '@/components/screen';
import { describeConnectFailure, type FailureView } from '@/features/host/connect-failure';
import { useHostV3 } from '@/lib/host-v3-provider';
import { parsePairParams } from '@/lib/pairing-v3';
import { readPhoneNetwork } from '@/lib/phone-network';
import { IconShieldExclamation } from '@/theme/glyphs';
import { colors } from '@/theme/tokens';

export default function PairScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ h?: string; p?: string; fp?: string; c?: string; n?: string; r?: string; rt?: string }>();
  const { pair } = useHostV3();
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<FailureView | null>(null);
  const [pairing, setPairing] = useState(true);
  // Display only: whether this link pairs through the Mac's registered relay.
  const target = parsePairParams(params);
  // The code is single-use: a re-render or strict-mode remount must not spend it twice — but a new
  // link landing on this screen (it stays mounted on the failure page) carries a new code and pairs again.
  const spentCode = useRef<string | null>(null);

  useEffect(() => {
    const code = params.c ?? '';
    // A cleared param set after a spent link (the screen is still mounted while `router.replace('/')`
    // runs) is not a new link: it must not turn a successful pairing into "incomplete or damaged".
    if (spentCode.current !== null && (code === '' || code === spentCode.current)) return;
    spentCode.current = code;
    setError(null);
    setFailure(null);
    setPairing(true);
    const target = parsePairParams(params);
    if (!target) {
      setPairing(false);
      setError('This pairing link is incomplete or damaged. Show the QR code on the computer again.');
      return;
    }
    void pair(target)
      .then(() => router.replace('/'))
      .catch(async (cause: unknown) => {
        const network = await readPhoneNetwork();
        setFailure(describeConnectFailure(cause, { host: target.host, port: target.port, network, tunnel: Boolean(target.tailcat) }));
        setPairing(false);
        setError(cause instanceof Error ? cause.message : 'Pairing did not complete.');
      });
  }, [pair, params, router]);

  return (
    <Screen back title="Pairing">
      <SafeAreaView style={{ flex: 1 }} edges={['bottom']}>
        <YStack flex={1} alignItems="center" justifyContent="center" gap="$3" padding="$6">
          {pairing && !error ? (
            <>
              <Spinner color={colors.accent} size="large" />
              <Text color={colors.textMuted} fontSize={13}>Pairing…</Text>
              {target?.relay ? (
                <Text color={colors.textSubtle} fontSize={12}>Connecting via relay to {target.host}</Text>
              ) : null}
            </>
          ) : (
            <Fade style={{ alignItems: 'center', gap: 12 }}>
              <Icon as={IconShieldExclamation} size="lg" tone="attention" />
              <Text color={colors.text} fontSize={17} fontWeight="700">Pairing failed{failure ? ` — ${failure.title}` : ''}</Text>
              {failure ? <Text color={colors.textSubtle} fontSize={12} textAlign="center">{failure.detail}</Text> : null}
              <Text color={colors.textMuted} fontSize={13} lineHeight={19} textAlign="center">
                {failure?.hint ?? error ?? 'Pairing did not complete.'}
              </Text>
              <PillButton label="Paste the link instead" onPress={() => router.replace('/connect')} />
            </Fade>
          )}
        </YStack>
      </SafeAreaView>
    </Screen>
  );
}
