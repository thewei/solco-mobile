// [INPUT]: a terminal id (+ instance, title) from the Home list and the Go Host v3 terminal stream.
// [OUTPUT]: Full-screen terminal: the Host's own observe grid rendered by xterm, direct typing, a
//           whole-line input with Send, a key row (esc tab ctrl-c arrows backspace enter), a Ctrl
//           modifier toggle, and a jump-to-latest pill for touch scrollback.
//           The control bar hides once the Host reports the terminal gone (4404).
// [POS]: P1 terminal surface. The phone owns its grid — the Host renders the pane at the phone's
//        cols×rows without resizing the Mac's pane — so a keyboard or rotation change just restarts
//        the stream with a full first frame. Reconnects with a capped backoff; a 4404 close means the
//        terminal is gone and ends the session. Safe area and keyboard ride the shared
//        safe-area-context SafeAreaView + KeyboardInset (edge-to-edge correct).
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, CornerDownLeft, Delete, Send } from 'lucide-react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Text, XStack, YStack } from 'tamagui';

import { ChangesButton } from '@/components/changes-button';
import { Icon } from '@/components/icon';
import { KeyboardInset } from '@/components/keyboard-inset';
import type { NativeTerminalHandle } from '@/components/native-terminal';
import type { TerminalSession } from '@/lib/host-client-v3';
import { useHostV3 } from '@/lib/host-v3-provider';
import { colors, radii } from '@/theme/tokens';

// The xterm adapter wraps react-native-webview (native-only) — never in web bundles.
const LazyNativeTerminal = Platform.OS !== 'web'
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ? require('@/components/native-terminal').default as typeof import('@/components/native-terminal').default
  : null;

const RESIZE_DEBOUNCE_MS = 250;
const RECONNECT_BASE_MS = 500;
const RECONNECT_CAP_MS = 8_000;

type Phase = 'connecting' | 'live' | 'reconnecting' | 'gone';

const KEYS: { label: string; key: string; icon?: React.ReactNode }[] = [
  { label: 'Esc', key: 'esc' },
  { label: 'Tab', key: 'tab' },
  { label: '^C', key: 'ctrl+c' },
  { label: '↑', key: 'up', icon: <Icon as={ArrowUp} size="sm" tone="text" /> },
  { label: '↓', key: 'down', icon: <Icon as={ArrowDown} size="sm" tone="text" /> },
  { label: '←', key: 'left', icon: <Icon as={ArrowLeft} size="sm" tone="text" /> },
  { label: '→', key: 'right', icon: <Icon as={ArrowRight} size="sm" tone="text" /> },
  { label: '⌫', key: 'backspace', icon: <Icon as={Delete} size="sm" tone="text" /> },
  { label: '⏎', key: 'enter', icon: <Icon as={CornerDownLeft} size="sm" tone="text" /> },
];

export default function TerminalScreen() {
  const router = useRouter();
  const { client } = useHostV3();
  const params = useLocalSearchParams<{ terminalId: string; instance?: string; title?: string }>();
  const terminalId = Array.isArray(params.terminalId) ? params.terminalId[0] : params.terminalId;
  const instance = (Array.isArray(params.instance) ? params.instance[0] : params.instance) ?? '';
  const title = (Array.isArray(params.title) ? params.title[0] : params.title) || 'Terminal';

  const terminalRef = useRef<NativeTerminalHandle>(null);
  const sessionRef = useRef<TerminalSession | null>(null);
  const gridRef = useRef<{ cols: number; rows: number } | null>(null);
  const resizeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const attempts = useRef(0);
  const stopped = useRef(false);

  const [phase, setPhase] = useState<Phase>('connecting');
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [ctrlArmed, setCtrlArmed] = useState(false);
  const [atLive, setAtLive] = useState(true);

  // The reconnect timer fires later: it must open with the client of that moment, not the one it was armed with.
  const openRef = useRef<() => void>(() => undefined);
  const open = useCallback(() => {
    const grid = gridRef.current;
    if (!client || !terminalId || !grid || stopped.current) return;
    sessionRef.current?.close();
    sessionRef.current = client.openTerminal(instance, terminalId, grid, {
      onEvent(event) {
        if (event.kind === 'frame') {
          attempts.current = 0;
          setPhase('live');
          terminalRef.current?.write(event.frame.bytes);
        } else if (event.kind === 'input-error') {
          setNotice(event.message ?? (event.code === 'refused' ? 'That input was refused.' : 'Input was not accepted.'));
        }
      },
      onClose({ gone }) {
        sessionRef.current = null;
        if (stopped.current) return;
        if (gone) {
          setPhase('gone');
          return;
        }
        setPhase('reconnecting');
        attempts.current += 1;
        const delay = Math.min(RECONNECT_BASE_MS * 2 ** (attempts.current - 1), RECONNECT_CAP_MS);
        reconnectTimer.current = setTimeout(() => openRef.current(), delay);
      },
    });
  }, [client, instance, terminalId]);
  openRef.current = open;

  useEffect(() => {
    stopped.current = false;
    return () => {
      stopped.current = true;
      clearTimeout(resizeTimer.current);
      clearTimeout(reconnectTimer.current);
      sessionRef.current?.close();
      sessionRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(null), 4_000);
    return () => clearTimeout(timer);
  }, [notice]);

  // The renderer reports its fitted grid on ready and on every layout change (keyboard, rotation).
  const onResize = useCallback(
    (cols: number, rows: number) => {
      const first = gridRef.current === null;
      gridRef.current = { cols, rows };
      if (first) {
        open();
        return;
      }
      clearTimeout(resizeTimer.current);
      resizeTimer.current = setTimeout(() => sessionRef.current?.resize({ cols, rows }), RESIZE_DEBOUNCE_MS);
    },
    [open],
  );

  const sendKey = (key: string) => {
    if (ctrlArmed) {
      setCtrlArmed(false);
      sessionRef.current?.sendInput({ keys: [key === 'ctrl+c' ? key : `ctrl+${key}`] });
      return;
    }
    sessionRef.current?.sendInput({ keys: [key] });
  };
  const sendLine = () => {
    setCtrlArmed(false);
    if (!draft) {
      sendKey('enter');
      return;
    }
    const sent = sessionRef.current?.sendInput({ text: draft, keys: ['enter'] });
    if (sent === false) setNotice('That line is too long to send.');
    else setDraft('');
  };

  const banner = phase === 'gone' ? 'This terminal no longer exists.' : phase === 'reconnecting' ? 'Reconnecting…' : phase === 'connecting' ? 'Connecting…' : null;

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title,
          headerBackTitle: 'Back',
          headerRight: () => <ChangesButton instance={instance ?? ''} terminalId={terminalId ?? ''} />,
        }}
      />
      <SafeAreaView edges={['bottom']} style={{ flex: 1, backgroundColor: colors.terminal }}>
        <KeyboardInset>
          <YStack flex={1}>
            {LazyNativeTerminal ? (
              <LazyNativeTerminal
                ref={terminalRef}
                onInput={(data) => {
                  const lower = data.toLowerCase();
                  const composes = ctrlArmed && data.length === 1 && lower >= 'a' && lower <= 'z';
                  if (ctrlArmed) setCtrlArmed(false);
                  if (composes) {
                    sessionRef.current?.sendInput({ keys: [`ctrl+${lower}`] });
                    return;
                  }
                  sessionRef.current?.sendInput({ text: data });
                }}
                onResize={onResize}
                onScrollBottom={setAtLive}
              />
            ) : null}
            {banner || notice ? (
              <YStack position="absolute" top={8} left={12} right={12} alignItems="center">
                <Text
                  color={phase === 'gone' ? colors.danger : colors.attention}
                  backgroundColor={colors.surfaceRaised}
                  borderRadius={radii.pill}
                  paddingHorizontal="$3"
                  paddingVertical="$1.5"
                  fontSize={12}
                  fontWeight="650">
                  {notice ?? banner}
                </Text>
                {phase === 'gone' ? (
                  <Button unstyled marginTop="$2" paddingHorizontal="$4" paddingVertical="$2" borderRadius={radii.pill} backgroundColor={colors.accent} onPress={() => router.back()}>
                    <Text color="#FFFFFF" fontSize={13} fontWeight="650">Back to list</Text>
                  </Button>
                ) : null}
              </YStack>
            ) : null}
            {!atLive ? (
              <Button
                unstyled
                position="absolute"
                bottom={12}
                right={12}
                paddingHorizontal="$3"
                paddingVertical="$1.5"
                borderRadius={radii.pill}
                backgroundColor={colors.surfaceRaised}
                pressStyle={{ backgroundColor: colors.surfacePressed }}
                accessibilityRole="button"
                accessibilityLabel="Jump to latest"
                onPress={() => {
                  setAtLive(true);
                  terminalRef.current?.toLive();
                }}>
                <Text color={colors.text} fontSize={12} fontWeight="650">↓ Latest</Text>
              </Button>
            ) : null}
          </YStack>

          {phase !== 'gone' ? (
          <YStack backgroundColor={colors.surface} borderTopColor={colors.border} borderTopWidth={1} padding="$2" gap="$2">
            <XStack gap="$1.5" justifyContent="space-between">
              {KEYS.map((item) => (
                <Button
                  key={item.key}
                  unstyled
                  flex={1}
                  height={38}
                  alignItems="center"
                  justifyContent="center"
                  borderRadius={radii.sm}
                  backgroundColor={colors.surfaceRaised}
                  pressStyle={{ backgroundColor: colors.surfacePressed }}
                  accessibilityRole="button"
                  accessibilityLabel={`Key ${item.key}`}
                  onPress={() => sendKey(item.key)}>
                  {item.icon ?? <Text color={colors.text} fontSize={13} fontWeight="650">{item.label}</Text>}
                </Button>
              ))}
            </XStack>
            <XStack gap="$2" alignItems="center">
              <Button
                unstyled
                width={42}
                height={42}
                borderRadius={radii.sm}
                alignItems="center"
                justifyContent="center"
                backgroundColor={ctrlArmed ? colors.accent : colors.surfaceRaised}
                pressStyle={{ backgroundColor: colors.surfacePressed }}
                accessibilityRole="button"
                accessibilityLabel="Control modifier for the next key"
                accessibilityState={{ selected: ctrlArmed }}
                onPress={() => setCtrlArmed((armed) => !armed)}>
                <Text color={ctrlArmed ? '#FFFFFF' : colors.text} fontSize={13} fontWeight="650">Ctrl</Text>
              </Button>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                onSubmitEditing={sendLine}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="Type a line, then send"
                placeholderTextColor={colors.textSubtle}
                returnKeyType="send"
                blurOnSubmit={false}
                style={{
                  flex: 1,
                  height: 42,
                  paddingHorizontal: 14,
                  borderRadius: radii.pill,
                  backgroundColor: colors.surfaceRaised,
                  color: colors.text,
                  fontSize: 14,
                }}
              />
              <Button
                unstyled
                width={42}
                height={42}
                borderRadius={21}
                alignItems="center"
                justifyContent="center"
                backgroundColor={colors.accent}
                accessibilityRole="button"
                accessibilityLabel="Send line"
                onPress={sendLine}>
                <Icon as={Send} tone="onAccent" />
              </Button>
            </XStack>
          </YStack>
          ) : null}
        </KeyboardInset>
      </SafeAreaView>
    </>
  );
}
