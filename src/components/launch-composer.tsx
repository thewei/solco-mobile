// [INPUT]: the Host's launchKinds, the tree's workspaces, the chosen instance and whether Chat is served.
// [OUTPUT]: LaunchComposer — Home's new-session card. `collapsible` (Home): a slim card at the bottom that rises (one clock, one motion with the keyboard)
//           over a dimmed list on tap and folds back down after a send, a tap outside or Back; the light form has a
//           folder chip, Agent/Terminal mode, agent chip, a prompt (Terminal: its first command, one line) and send,
//           plus "open full composer" which carries the agent draft to `/compose` (the Chat page's own composer).
//           An agent send with Chat served navigates at once to the pending Chat screen (`pending-<requestId>`):
//           that screen runs the POST /launch while the prompt already stands in as its first row. A Terminal send
//           (and a Host without Chat) keeps the round-trip. Both hand-offs and the full-composer open grow the next
//           screen out of this card (`lib/zoom-origin` + `ZoomIn`).
//           Not collapsible (the share page): the same form, always open, in flow.
// [POS]: Option C of designs/mobile-shell (Home composer). Everything it does is one POST /launch; the Host runs
//        the same transaction as the desktop and answers with the pane. Empty prompt = start the agent only
//        (Terminal: just the shell). Never moves the Mac's focus.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { ArrowUp, ChevronDown, ChevronUp, Folder, Maximize2, Plus } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Keyboard, Platform, Pressable, StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Input, Spinner, Text, XStack, YStack } from 'tamagui';

import { Icon } from '@/components/icon';
import { KeyboardDock } from '@/components/keyboard-inset';
import { AgentSheet, Chip, FolderSheet } from '@/components/launch-pickers';
import { Tap } from '@/components/tap';
import { LAUNCH_TERMINAL, type TreeWorkspace } from '@/contracts/host-v3';
import { isDeviceInstance } from '@/features/host/device-model';
import {
  buildLaunchBody,
  createLaunchAttempts,
  defaultTarget,
  launchFailureMessage,
  launchRoute,
  targetLabel,
  type LaunchTarget,
} from '@/features/host/launch-model';
import { useHostV3 } from '@/lib/host-v3-provider';
import { setZoomOrigin } from '@/lib/zoom-origin';
import { useSessionStore } from '@/state/session-store';
import { colors, radii } from '@/theme/tokens';

interface Props {
  instance: string;
  kinds: readonly { id: string; label: string }[];
  workspaces: readonly TreeWorkspace[];
  chatServed: boolean;
  /** Seeds the prompt (the share sheet's text). */
  initialPrompt?: string;
  /** Replaces the host screen with the new pane instead of stacking on it (the share page). */
  replace?: boolean;
  /** Home: a slim card that opens upward over the screen. Otherwise the form is always open, in flow. */
  collapsible?: boolean;
}

const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });

export function LaunchComposer({ instance, kinds, workspaces, chatServed, initialPrompt = '', replace = false, collapsible = false }: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { client } = useHostV3();
  const agentKinds = useMemo(() => kinds.filter((k) => k.id !== LAUNCH_TERMINAL), [kinds]);
  const canTerminal = kinds.some((k) => k.id === LAUNCH_TERMINAL);
  const attempts = useRef(createLaunchAttempts()).current;

  const [target, setTarget] = useState<LaunchTarget | null>(() => defaultTarget(workspaces));
  // The last pick lives in the session store (and on disk): it survives a Chat round-trip and an app restart. A
  // stored agent the Host no longer lists falls back to the first one without overwriting the stored pick.
  const launchAgent = useSessionStore((state) => state.launchAgent);
  const launchTerminal = useSessionStore((state) => state.launchTerminal);
  const agent = agentKinds.some((k) => k.id === launchAgent) ? launchAgent : (agentKinds[0]?.id ?? null);
  const terminal = agentKinds.length === 0 || (launchTerminal && canTerminal);
  const setAgent = (next: string | null) => useSessionStore.getState().setLaunchPick({ agent: next });
  const setTerminal = (next: boolean) => useSessionStore.getState().setLaunchPick({ terminal: next });
  const [prompt, setPrompt] = useState(initialPrompt);
  const [sheet, setSheet] = useState<'folder' | 'agent' | null>(null);
  const [open, setOpen] = useState(!collapsible);
  // The overlay stays mounted while it fades out; `progress` is its one clock (0 closed → 1 open).
  const [mounted, setMounted] = useState(!collapsible);
  const progress = useSharedValue(collapsible ? 0 : 1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A Mac with no Workspace yet offers none until the tree arrives; adopt the first one then.
  useEffect(() => {
    if (!target) setTarget(defaultTarget(workspaces));
  }, [target, workspaces]);

  const kind = terminal || !agent ? LAUNCH_TERMINAL : agent;
  const kindLabel = kinds.find((k) => k.id === kind)?.label ?? kind;
  const canSend = !busy && target !== null && (kind === LAUNCH_TERMINAL ? canTerminal : agent !== null);

  const send = async () => {
    if (!target || !canSend) return;
    const body = buildLaunchBody({ target, kind, prompt });
    if (kind !== LAUNCH_TERMINAL && chatServed) {
      // The pending Chat screen owns the launch from here: it opens now — the prompt already standing in as its
      // first row over a working shimmer — and runs the POST /launch itself (the seeded requestId replays it).
      const requestId = attempts.begin(body);
      const where = target.type === 'workspace' ? { workspaceId: target.id } : { path: target.path };
      handOffOrigin();
      setPrompt('');
      if (collapsible) setOpen(false);
      const route = {
        pathname: '/chat/[paneId]' as const,
        params: { paneId: `pending-${requestId}`, instance, kind, prompt: body.prompt ?? '', title: kindLabel, ...where },
      };
      if (replace) router.replace(route);
      else router.push(route);
      return;
    }
    if (!client) return;
    setBusy(true);
    setError(null);
    try {
      const reply = await client.launch(instance, { requestId: attempts.begin(body), ...body });
      attempts.settle(null);
      setPrompt('');
      if (collapsible) setOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['v3', 'tree', instance] });
      const route = launchRoute(reply, instance, kind === LAUNCH_TERMINAL ? `${targetLabel(target)} terminal` : kindLabel, chatServed, body.prompt ?? '');
      if (replace) router.replace(route);
      else router.push(route);
    } catch (failure) {
      attempts.settle(failure);
      setError(launchFailureMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  const pickTarget = (next: LaunchTarget) => {
    setTarget(next);
    setSheet(null);
    setError(null);
  };

  // The zoom hand-off: the Chat / New-session screen grows out of this card's on-screen rect (`ZoomIn` reads
  // the slot once on mount). A missed measure (hidden card, desktop shell) zooms from center — still soft.
  const cardBox = useRef<View | null>(null);
  const handOffOrigin = () => {
    cardBox.current?.measureInWindow((x, y, width, height) => {
      if (width > 0 && height > 0) setZoomOrigin({ x, y, width, height });
    });
  };

  // One motion, not two: the card fades up while the keyboard (focused at once) carries the dock up with it. No
  // spring and no entering/exiting layout animation — a keyboard rising mid-animation left those stuck on Android.
  const inputRef = useRef<{ focus: () => void } | null>(null);
  useEffect(() => {
    if (!collapsible) return undefined;
    if (open) {
      setMounted(true);
      progress.set(withTiming(1, { duration: 240, easing: Easing.out(Easing.cubic) }));
      const frame = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(frame);
    }
    Keyboard.dismiss();
    progress.set(withTiming(0, { duration: 170, easing: Easing.in(Easing.quad) }));
    const timer = setTimeout(() => setMounted(false), 190);
    return () => clearTimeout(timer);
  }, [collapsible, open, progress]);
  useEffect(() => {
    if (collapsible && open) inputRef.current?.focus(); // the mode switch swaps the input
  }, [collapsible, open, terminal]);
  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.get() }));
  const cardStyle = useAnimatedStyle(() => ({ opacity: progress.get(), transform: [{ translateY: (1 - progress.get()) * 28 }] }));

  // Android Back folds an open card instead of leaving Home.
  useEffect(() => {
    if (!collapsible || !open) return undefined;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setOpen(false);
      return true;
    });
    return () => subscription.remove();
  }, [collapsible, open]);

  // The agent draft moves to the full composer page (which owns attachments, `/` `$` `@`, models), so Home keeps none.
  const openFull = () => {
    if (!agent || target === null) return;
    handOffOrigin();
    const where = target.type === 'workspace' ? { workspaceId: target.id } : { path: target.path };
    router.push({ pathname: '/compose', params: { instance, kind: agent, draft: prompt, ...where } });
    setPrompt('');
    setOpen(false);
  };

  const form = (
    <YStack paddingHorizontal="$3" paddingBottom="$2" paddingTop="$2" gap="$2">
      <YStack ref={cardBox as never} backgroundColor={colors.surface} borderColor={colors.border} borderWidth={1} borderRadius={24} padding="$2.5" gap="$2">
        <XStack gap="$2" alignItems="center">
          <Chip
            label={target ? targetLabel(target) : 'Choose folder'}
            accessibilityLabel={`Folder: ${target ? targetLabel(target) : 'none'}`}
            icon={<Icon as={Folder} size="sm" tone="muted" />}
            onPress={() => setSheet('folder')}
          />
          {canTerminal && agentKinds.length > 0 ? (
            <XStack gap="$1.5">
              <Chip label="Agent" active={!terminal} onPress={() => setTerminal(false)} />
              <Chip label="Terminal" active={terminal} onPress={() => setTerminal(true)} />
            </XStack>
          ) : null}
          <YStack flex={1} />
          {collapsible ? (
            <Tap role="button" accessibilityLabel="Collapse" onPress={() => setOpen(false)} width={32} height={32} alignItems="center" justifyContent="center">
              <Icon as={ChevronDown} size="sm" tone="muted" />
            </Tap>
          ) : null}
        </XStack>

        {terminal ? (
          <Input
            height={44}
            unstyled
            ref={inputRef as never}
            value={prompt}
            onChangeText={setPrompt}
            onSubmitEditing={() => void send()}
            returnKeyType="send"
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            placeholder="Run a command (optional)"
            placeholderTextColor="$placeholderColor"
            color={colors.text}
            fontFamily={MONO}
            fontSize={14}
            paddingHorizontal="$1"
          />
        ) : (
          <Input
            minHeight={44}
            maxHeight={120}
            multiline
            unstyled
            ref={inputRef as never}
            value={prompt}
            onChangeText={setPrompt}
            placeholder="What should it work on? (optional)"
            placeholderTextColor="$placeholderColor"
            color={colors.text}
            fontSize={15}
            paddingHorizontal="$1"
            paddingVertical="$1.5"
          />
        )}

        <XStack alignItems="center" gap="$1">
          {terminal || !agent ? <YStack /> : (
            <Chip label={kindLabel} icon={<Icon as={ChevronDown} size="sm" tone="muted" />} accessibilityLabel={`Agent: ${kindLabel}`} onPress={() => setSheet('agent')} />
          )}
          <XStack flex={1} />
          {collapsible && !terminal && agent ? (
            <Tap role="button" accessibilityLabel="Open full composer" onPress={openFull} width={40} height={40} alignItems="center" justifyContent="center">
              <Icon as={Maximize2} size="sm" tone="muted" />
            </Tap>
          ) : null}
          <Tap height={40} minWidth={40} paddingHorizontal={terminal && prompt.trim() === '' ? 16 : 0} borderRadius={radii.pill}
            alignItems="center" justifyContent="center" backgroundColor={canSend ? colors.accent : colors.surfaceRaised}
            disabled={!canSend} role="button" accessibilityLabel={terminal ? (prompt.trim() ? 'Run command' : 'Open terminal') : 'Start session'} onPress={() => void send()}>
            {busy ? <Spinner color={colors.canvas} /> : terminal && prompt.trim() === '' ? (
              <Text color={canSend ? colors.canvas : colors.textSubtle} fontSize={14} fontWeight="700">Open</Text>
            ) : (
              <Icon as={ArrowUp} tone={canSend ? 'onAccent' : 'subtle'} />
            )}
          </Tap>
        </XStack>
      </YStack>
      {error ? <Text color={colors.danger} fontSize={12} paddingHorizontal="$2">{error}</Text> : null}

      <FolderSheet visible={sheet === 'folder'} workspacesOnly={isDeviceInstance(instance)} workspaces={workspaces} target={target} onClose={() => setSheet(null)} onPick={pickTarget} />
      <AgentSheet visible={sheet === 'agent'} kinds={agentKinds} agent={agent} onClose={() => setSheet(null)} onPick={(id) => { setAgent(id); setSheet(null); }} />
    </YStack>
  );

  if (!collapsible) return form;

  const draftLine = prompt.trim().split('\n')[0] ?? '';
  return (
    <>
      <YStack paddingHorizontal="$3" paddingBottom="$2" paddingTop="$2" opacity={open ? 0 : 1} pointerEvents={open ? 'none' : 'auto'}>
        <Tap
          role="button"
          accessibilityLabel="New session"
          onPress={() => setOpen(true)}
          height={52}
          borderRadius={26}
          paddingHorizontal={14}
          flexDirection="row"
          alignItems="center"
          gap={10}
          backgroundColor={colors.surface}
          borderWidth={1}
          borderColor={colors.border}>
          <Icon as={Plus} tone="accent" />
          <Text flex={1} color={draftLine ? colors.text : colors.textMuted} fontSize={14.5} numberOfLines={1}>
            {draftLine || 'Start a new session…'}
          </Text>
          {target ? <Text color={colors.textSubtle} fontSize={12} maxWidth={96} numberOfLines={1}>{targetLabel(target)}</Text> : null}
          <Icon as={ChevronUp} size="sm" tone="subtle" />
        </Tap>
      </YStack>
      {mounted ? (
        <View style={StyleSheet.absoluteFill}>
          <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]}>
            <Pressable accessibilityLabel="Close composer" onPress={() => setOpen(false)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }} />
          </Animated.View>
          <KeyboardDock>
            <View style={{ flex: 1, justifyContent: 'flex-end' }} pointerEvents="box-none">
              <Animated.View style={cardStyle}>{form}</Animated.View>
            </View>
          </KeyboardDock>
        </View>
      ) : null}
    </>
  );
}
