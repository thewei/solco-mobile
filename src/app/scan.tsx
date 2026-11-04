// [INPUT]: the camera preview (expo-camera, QR only) and the camera permission.
// [OUTPUT]: ScanScreen — reads the pairing QR the Mac shows and hands the parsed link to /pair.
// [POS]: The camera twin of the paste form. It decodes and validates the link, nothing more:
//        pairing itself (pinned channel, single-use code) stays in pair.tsx, and nothing scanned
//        is stored or logged. Anything that is not a Solco pairing link is ignored, not repaired.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Text, YStack } from 'tamagui';

import { pairTargetParams, parsePairUrl } from '@/lib/pairing-v3';
import { colors, radii } from '@/theme/tokens';

export default function ScanScreen() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [hint, setHint] = useState<string | null>(null);
  // One QR frame arrives many times a second; the code is single-use, so hand off exactly once.
  const handled = useRef(false);

  const onScanned = ({ data }: { data: string }) => {
    if (handled.current) return;
    const target = parsePairUrl(data);
    if (!target) {
      setHint('That QR code is not a Solco pairing code.');
      return;
    }
    handled.current = true;
    router.replace({
      pathname: '/pair',
      params: pairTargetParams(target),
    });
  };

  if (!permission) return <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }} />;

  if (!permission.granted) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }} edges={['bottom']}>
        <YStack flex={1} alignItems="center" justifyContent="center" gap="$3" padding="$6">
          <Text color={colors.text} fontSize={17} fontWeight="700">Camera access</Text>
          <Text color={colors.textMuted} fontSize={13} lineHeight={19} textAlign="center">
            Scan the pairing QR code shown on your computer.
          </Text>
          {permission.canAskAgain ? (
            <Button
              unstyled
              paddingHorizontal="$4"
              paddingVertical="$2.5"
              borderRadius={radii.pill}
              backgroundColor={colors.accent}
              accessibilityRole="button"
              accessibilityLabel="Allow camera"
              onPress={() => void requestPermission()}>
              <Text color="#FFFFFF" fontSize={13} fontWeight="650">Allow camera</Text>
            </Button>
          ) : (
            <Text color={colors.attention} fontSize={13} textAlign="center">
              Camera access is off for this app. Turn it on in the system settings, or paste the link instead.
            </Text>
          )}
        </YStack>
      </SafeAreaView>
    );
  }

  return (
    <YStack flex={1} backgroundColor="#000000">
      <CameraView
        style={{ flex: 1 }}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={onScanned}
      />
      <SafeAreaView edges={['bottom']} style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
        <YStack alignItems="center" padding="$4">
          <Text
            color="#FFFFFF"
            fontSize={13}
            textAlign="center"
            paddingHorizontal="$4"
            paddingVertical="$2"
            borderRadius={radii.pill}
            backgroundColor="rgba(0,0,0,0.6)">
            {hint ?? 'Point at the QR code in Solco → Settings → Remote Access'}
          </Text>
        </YStack>
      </SafeAreaView>
    </YStack>
  );
}
