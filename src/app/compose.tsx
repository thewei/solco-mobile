// [INPUT]: instance + the folder (workspaceId | path) + agent kind + a draft handed over by the New chat entry points (the Chats FAB,
//          a Workspace's "New chat in …", LaunchComposer's full-composer button), and the Host's pane-less composer endpoints
//          (`/launch/catalog|files|attachments`).
// [OUTPUT]: the New chat page (designs/mobile-t3-redesign `new-chat`): the shared Screen bar ("New chat", with the chosen
//           Workspace's Files and Changes), the hero ("What should we build in <workspace>?", host and agent chips) over the
//           desktop's own Chat page (solco/frontend, embedded as `generated/chat-page.ts`) as a NEW-SESSION draft — an empty
//           conversation whose composer has everything the live Chat has (`/` `$` skills, `@` files, attachments, model panel,
//           voice) — and the Workspace / Host / Agent sheets. The first agent send hands the launch to the pending Chat screen
//           (a `pending-<requestId>` route carrying folder + kind + text) and replaces this draft with it; a terminal send
//           keeps the round-trip and replaces the screen with the pane's terminal. A launch refusal reaches the page as the
//           sentence above its composer (`outcome`); an unreachable host is the banner above the hero.
// [POS]: The New chat end of every "start something" entry. It reuses the unchanged page through the same
//        `features/chat-web` controller as `/chat/[paneId]`; only the ops differ (catalog/files/upload by folder, send =
//        launch). Nothing here moves the Mac's focus. Before the page's first paint the screen keeps a skeleton cover and
//        cross-fades it out (`onReady`, as in Chat; the page keeps itself hidden until then — features/chat-web/protocol).
//        The body fades in.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Banner } from '@/components/banner';
import { ChatPageView } from '@/components/chat/chat-page-view';
import { EmptyState } from '@/components/empty-state';
import { HostChoices } from '@/components/host-choices';
import { KeyboardInset } from '@/components/keyboard-inset';
import { AgentSheet, FolderSheet } from '@/components/launch-pickers';
import { Fade, Skeleton } from '@/components/motion';
import { NewChatHero } from '@/components/new-chat-hero';
import { OptionSheet } from '@/components/option-sheet';
import { Screen } from '@/components/screen';
import { LAUNCH_TERMINAL } from '@/contracts/host-v3';
import { createChatController, type ChatOps } from '@/features/chat-web/controller';
import type { PageState } from '@/features/chat-web/page-state';
import { capabilitiesFor, isDeviceInstance } from '@/features/host/device-model';
import {
  buildLaunchBody,
  createLaunchAttempts,
  defaultTarget,
  draftFolder,
  launchFailureMessage,
  launchRoute,
  targetLabel,
  workspaceTargets,
  type LaunchTarget,
} from '@/features/host/launch-model';
import { useBootstrapV3, useHostInstance, useTreeV3 } from '@/features/host/queries-v3';
import { HostV3Error } from '@/lib/host-client-v3';
import { pickAttachment } from '@/lib/pick-attachment';
import { useAfterTransition } from '@/lib/use-after-transition';
import { useHostV3 } from '@/lib/host-v3-provider';
import { useChatPrefsStore } from '@/state/chat-prefs-store';
import { refusalText } from '@/features/chat/refusals';
import { IconAlertTriangle, IconFolder, IconGitBranch, IconLoader2 } from '@/theme/glyphs';
import { colors, radii, spacing } from '@/theme/tokens';

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

function sentence(e: unknown): Error {
  const failure = e instanceof HostV3Error ? e : null;
  return new Error(refusalText(failure?.code, failure?.message ?? String(e)));
}

const NOT_CONNECTED = 'Not connected.';
/**
 * Room the hero keeps clear under its centre. The design's hero is `padding-bottom: 200px` in the room above the composer, which
 * stands 68 dp (56 + the 12 dp margin) from the screen's bottom; the hero here spans the whole body, whose bottom is the 24 dp
 * navigation-bar inset higher, so: 200 + 68 − 24.
 */
const HERO_CLEARANCE = 244;

export default function ComposeScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const settled = useAfterTransition();
  const { client, connection } = useHostV3();
  const params = useLocalSearchParams<{ instance?: string; kind?: string; workspaceId?: string; path?: string; draft?: string }>();
  const { instance: defaultInstance } = useHostInstance();
  const instance = first(params.instance) || defaultInstance;
  // One conversation id per open: the page keeps its draft under it, so switching agent or folder keeps the text.
  const conversationId = useRef(`draft-${Date.now().toString(36)}`).current;
  const seedDraft = useRef(first(params.draft)).current;
  const attempts = useRef(createLaunchAttempts()).current;

  const bootstrap = useBootstrapV3();
  const tree = useTreeV3(instance || null);
  const workspaces = useMemo(() => tree.data?.workspaces ?? [], [tree.data]);
  const caps = bootstrap.data?.capabilities;
  const chatServed = caps?.chat === true;
  const attachServed = caps?.attachments === true;
  const voiceServed = caps?.voice === true && Platform.OS !== 'web';
  const agentKinds = useMemo(
    () => (caps?.launch ? (bootstrap.data?.launchKinds ?? []) : []).filter((k) => k.id !== LAUNCH_TERMINAL),
    [caps?.launch, bootstrap.data?.launchKinds],
  );

  const [pickedTarget, setPickedTarget] = useState<LaunchTarget | null>(null);
  const handedTarget = useMemo<LaunchTarget | null>(() => {
    const path = first(params.path);
    if (path) return { type: 'path', path };
    const id = first(params.workspaceId);
    return workspaceTargets(workspaces).find((t) => t.type === 'workspace' && t.id === id) ?? null;
  }, [params.path, params.workspaceId, workspaces]);
  const target = pickedTarget ?? handedTarget ?? defaultTarget(workspaces);
  const [pickedKind, setPickedKind] = useState(first(params.kind));
  const kind = agentKinds.some((k) => k.id === pickedKind) ? pickedKind : (agentKinds[0]?.id ?? '');
  const kindLabel = agentKinds.find((k) => k.id === kind)?.label ?? '';
  const [sheet, setSheet] = useState<'workspace' | 'host' | 'agent' | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pageReady, setPageReady] = useState(false);

  // One launch. An agent kind hands the launch to the pending Chat screen: it opens now with the prompt already
  // standing in as its first row, and the launch runs there (same requestId, so the hand-off replays safely).
  // A terminal keeps the old round-trip — a terminal has no transcript to stand anything in.
  const start = async (launchKind: string, prompt: string) => {
    if (!client || !instance || !target || !launchKind) throw new Error(NOT_CONNECTED);
    const body = buildLaunchBody({ target, kind: launchKind, prompt });
    setNotice(null);
    if (launchKind !== LAUNCH_TERMINAL && chatServed) {
      const requestId = attempts.begin(body);
      const where = target.type === 'workspace' ? { workspaceId: target.id } : { path: target.path };
      router.replace({
        pathname: '/chat/[paneId]',
        params: { paneId: `pending-${requestId}`, instance, kind: launchKind, prompt: body.prompt ?? '', title: kindLabel || launchKind, ...where },
      });
      return;
    }
    setStarting('Opening a terminal…');
    try {
      const reply = await client.launch(instance, { requestId: attempts.begin(body), ...body });
      attempts.settle(null);
      void queryClient.invalidateQueries({ queryKey: ['v3', 'tree', instance] });
      router.replace(launchRoute(reply, instance, `${targetLabel(target)} terminal`, chatServed, body.prompt ?? ''));
    } catch (failure) {
      attempts.settle(failure);
      setStarting(null);
      throw new Error(launchFailureMessage(failure));
    }
  };

  const [pageState, setPageState] = useState<PageState | null>(null);
  const opsRef = useRef<ChatOps | null>(null);
  opsRef.current = {
    send: (text) => start(kind, text),
    stop: async () => undefined,
    answer: async () => {
      throw new Error('Nothing to answer yet.');
    },
    catalog: async () => {
      if (!client || !instance || !target || !kind) throw new Error(NOT_CONNECTED);
      return client.draftCatalog(instance, draftFolder(target), kind);
    },
    // The page offers "Open Terminal" on an empty conversation; here that means a plain shell in the folder.
    openTerminal: () => void start(LAUNCH_TERMINAL, '').catch((e: unknown) => setNotice(e instanceof Error ? e.message : String(e))),
    older: () => undefined,
    files: async (token) => {
      if (!client || !instance || !target) return [];
      return client.draftFiles(instance, draftFolder(target), token);
    },
    canReview: () => false,
    review: () => undefined,
    canQueue: () => false,
    queue: async () => undefined,
    cancelQueued: async () => undefined,
    cancelQueuedItem: async () => undefined,
    canEdit: () => false,
    editQueuedItem: async () => undefined,
    moveQueuedItem: async () => undefined,
    subagent: async () => {
      throw new Error('Not available before the session starts.');
    },
    canAttach: () => attachServed,
    pickFile: async () => {
      try {
        return await pickAttachment();
      } catch (e) {
        throw e instanceof Error ? e : new Error('Could not read the file.');
      }
    },
    uploadFile: async (file) => {
      if (!client || !instance) throw new Error(NOT_CONNECTED);
      return client.uploadDraftAttachment(instance, file).catch((e: unknown) => {
        throw sentence(e);
      });
    },
    canVoice: () => voiceServed,
    transcribe: async (audioBase64, mime) => {
      if (!client) throw new Error(NOT_CONNECTED);
      const reply = await client.transcribe({ dataBase64: audioBase64, ...(mime ? { mime } : {}) }).catch((e: unknown) => {
        throw sentence(e);
      });
      return reply.text;
    },
    openMicrophoneSettings: () => void Linking.openSettings(),
    provider: () => kindLabel || undefined,
    outline: () => useChatPrefsStore.getState().chatOutline,
  };
  // A new agent or folder is a new catalog: the controller asks the Host once per (kind, folder).
  const draftKey = `${kind}|${target ? JSON.stringify(draftFolder(target)) : ''}`;
  const controller = useMemo(
    () => {
      void draftKey;
      return createChatController(
        conversationId,
        {
          send: (text, interrupt) => opsRef.current!.send(text, interrupt),
          stop: () => opsRef.current!.stop(),
          answer: (request) => opsRef.current!.answer(request),
          catalog: () => opsRef.current!.catalog(),
          openTerminal: () => opsRef.current!.openTerminal(),
          older: () => opsRef.current!.older(),
          files: (token) => opsRef.current!.files(token),
          canReview: () => opsRef.current!.canReview(),
          review: (path) => opsRef.current!.review(path),
          canQueue: () => opsRef.current!.canQueue(),
          queue: (text) => opsRef.current!.queue(text),
          cancelQueued: () => opsRef.current!.cancelQueued(),
          cancelQueuedItem: (requestId) => opsRef.current!.cancelQueuedItem(requestId),
          canEdit: () => opsRef.current!.canEdit(),
          editQueuedItem: (requestId, text) => opsRef.current!.editQueuedItem(requestId, text),
          moveQueuedItem: (requestId, to) => opsRef.current!.moveQueuedItem(requestId, to),
          subagent: (id) => opsRef.current!.subagent(id),
          canAttach: () => opsRef.current!.canAttach(),
          pickFile: () => opsRef.current!.pickFile(),
          uploadFile: (file) => opsRef.current!.uploadFile(file),
          canVoice: () => opsRef.current!.canVoice(),
          transcribe: (audioBase64, mime) => opsRef.current!.transcribe(audioBase64, mime),
          openMicrophoneSettings: () => opsRef.current!.openMicrophoneSettings(),
          provider: () => opsRef.current!.provider?.(),
          outline: () => opsRef.current!.outline?.() ?? false,
        },
        setPageState,
      );
    },
    [conversationId, draftKey],
  );
  useEffect(() => () => controller.dispose(), [controller]);
  useEffect(() => {
    // A refused start reads as the sentence above the composer, exactly as a failed start does on Chat.
    controller.feed({ phase: 'live', frame: null, fallbackStatus: 'idle', draft: true, ...(notice ? { outcome: notice } : {}) });
  }, [controller, attachServed, voiceServed, kindLabel, notice]);

  // A new draft conversation (kind or folder changed) reloads the page under the cover again.
  useEffect(() => {
    setPageReady(false);
  }, [draftKey]);

  const ready = target !== null && kind !== '';
  const hostName = connection?.name || bootstrap.data?.hostName || 'This computer';
  // An unreachable host: nothing to launch on, so the page (and its composer) is not offered, only the way to another host.
  const offline = (bootstrap.isError || tree.isError) && tree.data === undefined;
  const connecting = !offline && (tree.isLoading || bootstrap.isLoading);

  // The chosen Workspace's own Files and Changes, in the bar (only a Workspace has them; a typed folder does not).
  const toolCaps = caps ? capabilitiesFor(caps, instance) : undefined;
  const toolParams = target?.type === 'workspace' && instance ? { workspaceId: target.id, instance, title: targetLabel(target) } : null;
  const actions = toolParams
    ? [
        ...(toolCaps?.files ? [{ icon: IconFolder, label: 'Files', onPress: () => router.push({ pathname: '/files/[workspaceId]', params: toolParams }) }] : []),
        ...(toolCaps?.git ? [{ icon: IconGitBranch, label: 'Changes', onPress: () => router.push({ pathname: '/changes/[workspaceId]', params: toolParams }) }] : []),
      ]
    : [];

  const hero = (
    <NewChatHero
      workspace={target ? targetLabel(target) : 'a folder'}
      host={hostName}
      offline={offline}
      agent={kindLabel || undefined}
      starting={starting}
      bottomGap={ready ? HERO_CLEARANCE : 0}
      onWorkspace={() => setSheet('workspace')}
      onHost={() => setSheet('host')}
      onAgent={agentKinds.length > 0 ? () => setSheet('agent') : undefined}
    />
  );

  let body: React.ReactNode;
  if (offline) {
    body = (
      <View style={{ flex: 1 }}>
        <Banner tone="bad" text={`${hostName} is offline, so a new chat can’t start.`} action="Choose another host" onAction={() => setSheet('host')} />
        {hero}
      </View>
    );
  } else if (connecting) {
    body = <EmptyState spin icon={IconLoader2} title="Connecting…" text={`Reaching ${hostName}.`} />;
  } else if (!caps?.launch) {
    body = <EmptyState icon={IconAlertTriangle} title="Can’t start a chat here" text={`${hostName} doesn’t start new chats from the phone.`} />;
  } else {
    body = (
      <View style={{ flex: 1 }}>
        {ready ? (
          <>
            {pageState && settled ? (
              <Fade style={StyleSheet.absoluteFill}>
                <ChatPageView
                  key={draftKey}
                  state={pageState}
                  conversationId={conversationId}
                  seedDraft={seedDraft}
                  onCall={controller.call}
                  onReady={() => setPageReady(true)}
                />
              </Fade>
            ) : null}
            {!pageReady ? (
              <Fade style={StyleSheet.absoluteFill}>
                <View accessibilityRole="progressbar" accessibilityLabel="Loading the composer" style={{ flex: 1, justifyContent: 'flex-end', padding: spacing.screen, backgroundColor: colors.canvas }}>
                  <Skeleton height={56} radius={radii.pill} />
                </View>
              </Fade>
            ) : null}
          </>
        ) : null}
        {hero}
      </View>
    );
  }

  return (
    <Screen back title="New chat" actions={actions}>
      <SafeAreaView edges={['bottom']} style={{ flex: 1, backgroundColor: colors.canvas }}>
        <Fade style={{ flex: 1 }}>
          <KeyboardInset>{body}</KeyboardInset>
        </Fade>
      </SafeAreaView>
      <FolderSheet visible={sheet === 'workspace'} workspacesOnly={isDeviceInstance(instance)} workspaces={workspaces} target={target} onClose={() => setSheet(null)} onPick={(next) => { setPickedTarget(next); setSheet(null); }} />
      <OptionSheet visible={sheet === 'host'} title="Host" onClose={() => setSheet(null)}>
        <HostChoices onDone={() => setSheet(null)} />
      </OptionSheet>
      <AgentSheet visible={sheet === 'agent'} kinds={agentKinds} agent={kind} onClose={() => setSheet(null)} onPick={(id) => { setPickedKind(id); setSheet(null); }} />
    </Screen>
  );
}
