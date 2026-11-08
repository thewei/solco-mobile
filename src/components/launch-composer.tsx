// [INPUT]: the Host's launchKinds, the tree's workspaces, the chosen instance and whether Chat is served.
// [OUTPUT]: LaunchComposer — the light new-session form, always open and in flow: a workspace chip, Agent/Terminal mode, an
//           agent chip, a prompt (Terminal: its first command, one line) and send. An agent send with Chat served navigates
//           at once to the pending Chat screen (`pending-<requestId>`): that screen runs the POST /launch while the prompt
//           already stands in as its first row. A Terminal send (and a Host without Chat) keeps the round-trip.
// [POS]: The form of the share page and of Automations' "Let an Agent Draft" — the places that arrive with text to start a
//        session from. The New chat page (`/compose`) is the full composer (the shared Chat page's own); Chats' FAB opens
//        that. Everything here is one POST /launch; the Host runs the same transaction as the desktop and answers with
//        the pane. Empty prompt = start the agent only (Terminal: just the shell). Never moves the Mac's focus.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { Input, Spinner, Text, XStack, YStack } from 'tamagui';

import { Icon } from '@/components/icon';
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
import { useSessionStore } from '@/state/session-store';
import { IconArrowUp, IconChevronDown, IconFolder } from '@/theme/glyphs';
import { colors, radii, type as typeScale } from '@/theme/tokens';

interface Props {
  instance: string;
  kinds: readonly { id: string; label: string }[];
  workspaces: readonly TreeWorkspace[];
  chatServed: boolean;
  /** Seeds the prompt (the share sheet's text). */
  initialPrompt?: string;
  /** Replaces the host screen with the new pane instead of stacking on it (the share page). */
  replace?: boolean;
}

const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });

export function LaunchComposer({ instance, kinds, workspaces, chatServed, initialPrompt = '', replace = false }: Props) {
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
      setPrompt('');
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

  return (
    <YStack paddingHorizontal="$3" paddingBottom="$2" paddingTop="$2" gap="$2">
      <YStack backgroundColor={colors.surface} borderColor={colors.border} borderWidth={1} borderRadius={radii.bubble} padding="$2.5" gap="$2">
        <XStack gap="$2" alignItems="center">
          <Chip
            label={target ? targetLabel(target) : 'Choose workspace'}
            accessibilityLabel={`Workspace: ${target ? targetLabel(target) : 'none'}`}
            icon={<Icon as={IconFolder} size="sm" tone="muted" />}
            onPress={() => setSheet('folder')}
          />
          {canTerminal && agentKinds.length > 0 ? (
            <XStack gap="$1.5">
              <Chip label="Agent" active={!terminal} onPress={() => setTerminal(false)} />
              <Chip label="Terminal" active={terminal} onPress={() => setTerminal(true)} />
            </XStack>
          ) : null}
        </XStack>

        {terminal ? (
          <Input
            height={44}
            unstyled
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
            fontSize={typeScale.label.fontSize}
            paddingHorizontal="$1"
          />
        ) : (
          <Input
            minHeight={44}
            maxHeight={120}
            multiline
            unstyled
            value={prompt}
            onChangeText={setPrompt}
            placeholder="What should it work on? (optional)"
            placeholderTextColor="$placeholderColor"
            color={colors.text}
            fontSize={typeScale.body.fontSize}
            paddingHorizontal="$1"
            paddingVertical="$1.5"
          />
        )}

        <XStack alignItems="center" gap="$1">
          {terminal || !agent ? <YStack /> : (
            <Chip label={kindLabel} trailing={<Icon as={IconChevronDown} size="sm" tone="muted" />} accessibilityLabel={`Agent: ${kindLabel}`} onPress={() => setSheet('agent')} />
          )}
          <XStack flex={1} />
          <Tap height={44} minWidth={44} paddingHorizontal={terminal && prompt.trim() === '' ? 16 : 0} borderRadius={radii.pill}
            alignItems="center" justifyContent="center" backgroundColor={canSend ? colors.accent : colors.surfaceRaised}
            disabled={!canSend} role="button" accessibilityLabel={terminal ? (prompt.trim() ? 'Run command' : 'Open terminal') : 'Start session'} onPress={() => void send()}>
            {busy ? <Spinner color={colors.onAccent} /> : terminal && prompt.trim() === '' ? (
              <Text color={canSend ? colors.onAccent : colors.textSubtle} fontSize={typeScale.label.fontSize} fontWeight="700">Open</Text>
            ) : (
              <Icon as={IconArrowUp} tone={canSend ? 'onAccent' : 'subtle'} />
            )}
          </Tap>
        </XStack>
      </YStack>
      {error ? <Text color={colors.danger} fontSize={typeScale.caption.fontSize} lineHeight={typeScale.caption.lineHeight} paddingHorizontal="$2">{error}</Text> : null}

      <FolderSheet visible={sheet === 'folder'} workspacesOnly={isDeviceInstance(instance)} workspaces={workspaces} target={target} onClose={() => setSheet(null)} onPick={pickTarget} />
      <AgentSheet visible={sheet === 'agent'} kinds={agentKinds} agent={agent} onClose={() => setSheet(null)} onPick={(id) => { setAgent(id); setSheet(null); }} />
    </YStack>
  );
}
