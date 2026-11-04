// [INPUT]: a pane id (+ instance, terminal id, title, seed draft) from Home, or a `pending-<requestId>` hand-off
//          from Home/compose (target folder, agent kind, the prompt) whose launch this screen then runs, and the
//          Go Host v3 chat stream once the real pane exists.
// [OUTPUT]: the desktop's own Chat page (solco/frontend, embedded as `generated/chat-page.ts`) over this pane's
//           conversation: turns, thinking/tool summary rows, changes card, Tasks tray, Question dock, composer
//           (Send / Stop / cut in). A pending hand-off shows the sent prompt as the first transcript row over a
//           working shimmer while the launch is in flight, then hands over to the pane's own stream — the page
//           never waits for the first frame to exist. The phone side is `features/chat-web` (state adapter +
//           `chat.*` bridge) and `components/chat/chat-page-view`; this screen wires the Host stream, the launch
//           and the operations to them.
// [POS]: P2/P3 Chat surface of the phone client. Navigation is client-local; nothing here moves the Mac's focus.
//        A refusal from the Host reaches the page as the sentence it maps to, never bypassed. A failed start
//        keeps the message row and says why above the composer; sending again relaunches (a fresh requestId,
//        except a transport failure, which replays the same one). The identity bar — two-line title (agent
//        name over provider · Workspace · age; while a launch is still in flight the handed-over target names
//        the Workspace), status slot and one ⋯ menu (Changes, Terminal, Close) — is a plain view at the top of
//        the screen body (`headerShown: false`): the native header's custom subviews attach unreliably at mount
//        on Android, and the custom-header container thrashes here. The title block is the shared
//        `ChatHeaderTitle` (components/chat/chat-header) — the compose draft renders the same voice.
// [PROTOCOL]: 变更时更新此头部，然后检查 ../CLAUDE.md
import { useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, Bot, Folder, GitCompare, Terminal, X } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text, XStack, YStack } from 'tamagui';

import { ChatHeaderTitle } from '@/components/chat/chat-header';
import { ChatPageView } from '@/components/chat/chat-page-view';
import { HeaderMenu } from '@/components/header-menu';
import { IconButton } from '@/components/icon-button';
import { KeyboardInset } from '@/components/keyboard-inset';
import { Fade, Skeleton, ZoomIn } from '@/components/motion';
import { StatusSlot } from '@/components/status-slot';
import { refusalText } from '@/features/chat/refusals';
import { createChatController, type ChatOps } from '@/features/chat-web/controller';
import type { PageState } from '@/features/chat-web/page-state';
import {
  buildLaunchBody,
  createLaunchAttempts,
  draftFolder,
  folderName,
  launchFailureMessage,
  launchRoute,
  newRequestId,
  type LaunchBody,
  type LaunchTarget,
} from '@/features/host/launch-model';
import { agoShort, flattenPanes, paneTitle } from '@/features/host/pane-model';
import { useBootstrapV3, useChatStream, useHostInstance, useTreeV3 } from '@/features/host/queries-v3';
import { HostV3Error } from '@/lib/host-client-v3';
import { pickAttachment } from '@/lib/pick-attachment';
import { useAfterTransition } from '@/lib/use-after-transition';
import { useHostV3 } from '@/lib/host-v3-provider';
import { colors, spacing } from '@/theme/tokens';

/** A Host refusal as the sentence the page shows. */
function sentence(e: unknown): Error {
  const failure = e instanceof HostV3Error ? e : null;
  return new Error(refusalText(failure?.code, failure?.message ?? String(e)));
}


const NOT_CONNECTED = 'Not connected.';
const PENDING_PREFIX = 'pending-';

interface PendingLaunch {
  requestId: string;
  kind: string;
  prompt: string;
  target: LaunchTarget | null;
  /** The launch body the hand-off committed to; the seeded requestId replays exactly this. */
  body: LaunchBody | null;
}

/** The `pending-<requestId>` hand-off (Home/compose navigated before the Host answered the launch). */
function pendingOf(params: {
  paneId?: string | string[];
  kind?: string | string[];
  prompt?: string | string[];
  workspaceId?: string | string[];
  path?: string | string[];
}): PendingLaunch | null {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
  const paneId = one(params.paneId);
  if (!paneId.startsWith(PENDING_PREFIX)) return null;
  const path = one(params.path);
  const workspaceId = one(params.workspaceId);
  const target: LaunchTarget | null = path
    ? { type: 'path', path }
    : workspaceId
      ? { type: 'workspace', id: workspaceId, label: '', cwd: '' }
      : null;
  const kind = one(params.kind);
  const prompt = one(params.prompt);
  return {
    requestId: paneId.slice(PENDING_PREFIX.length),
    kind,
    prompt,
    target,
    body: target && kind ? buildLaunchBody({ target, kind, prompt }) : null,
  };
}

export default function ChatScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const settled = useAfterTransition();
  const { client } = useHostV3();
  const params = useLocalSearchParams<{ paneId: string; instance?: string; terminalId?: string; title?: string; draft?: string; subagent?: string; assistant?: string } & Parameters<typeof pendingOf>[0]>();
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
  const paneIdParam = first(params.paneId);
  // Opened from an Assistant's contact: its page stays one tap away.
  const assistantId = first(params.assistant);
  const title = first(params.title) || 'Agent';
  const { instance: defaultInstance } = useHostInstance();
  const instance = first(params.instance) || defaultInstance;
  // Read once: a launch whose agent was blocked on a trust prompt hands its undelivered prompt over as the draft.
  const seedDraft = useRef(first(params.draft)).current;
  // A sub-agent row on Home lands here with that sub-agent's drawer up (read once).
  const openSubagent = useRef(first(params.subagent)).current || undefined;
  // The screen's conversation never changes identity, even when the pending launch adopts its real pane id:
  // the controller, the page's draft store and the WebView all live under this one id.
  const conversationId = paneIdParam;
  const pending = useRef(pendingOf(params)).current;
  const seedPrompt = pending?.prompt ?? '';

  const [adopted, setAdopted] = useState<{ paneId: string; terminalId: string } | null>(null);
  const [launching, setLaunching] = useState(pending !== null);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [promptPending, setPromptPending] = useState(false);
  const [pageReady, setPageReady] = useState(false);

  // The real pane once the launch answered; while it is null the screen owns the launch and no stream runs.
  const pane = adopted?.paneId ?? (pending ? null : paneIdParam);
  const terminalId = adopted?.terminalId ?? first(params.terminalId);

  const bootstrap = useBootstrapV3();
  const attachServed = bootstrap.data?.capabilities.attachments === true;
  // Dictation records in the WebView (getUserMedia) and the Mac transcribes: native hosts only, never the Web/PWA twin.
  const voiceServed = bootstrap.data?.capabilities.voice === true && Platform.OS !== 'web';
  const queueServed = bootstrap.data?.capabilities.queue === true;
  const queueEditServed = bootstrap.data?.capabilities.queueEdit === true;
  const gitServed = bootstrap.data?.capabilities.git === true;
  const filesServed = bootstrap.data?.capabilities.files === true;
  const { phase, frame, older } = useChatStream(instance, pane);
  const status = frame?.agentStatus;
  const tree = useTreeV3(instance || null);
  // One scan of the tree answers everything the header shows: the pane, its Workspace, its agent's meta.
  const located = useMemo(
    () => (pane ? flattenPanes(tree.data?.workspaces ?? []).find((item) => item.pane.paneId === pane) ?? null : null),
    [tree.data, pane],
  );
  const paneStatus = located?.pane.agent?.status;
  // An Assistant's conversation is titled by the Assistant: the pane's own title is the launch prompt.
  const heading = (assistantId ? title : '') || (located ? paneTitle(located.pane) : '') || title;
  const provider = located?.pane.agent?.provider ?? '';
  const workspaceLabel = located?.workspace.label ?? '';
  const ago = located ? agoShort(located.pane.agent?.lastActiveMs, Date.now()) : '';
  // While the launch is in flight the tree does not know the pane yet; the handed-over target still names the
  // Workspace, so the header keeps the same two-line voice a located pane has.
  const pendingWorkspaceLabel = useMemo(() => {
    const pendingTarget = pending?.target;
    if (!pendingTarget) return '';
    if (pendingTarget.type === 'workspace') {
      return (tree.data?.workspaces ?? []).find((w) => w.id === pendingTarget.id)?.label ?? '';
    }
    return folderName(pendingTarget.path);
  }, [pending, tree.data]);
  const headerWorkspace = located ? workspaceLabel : pendingWorkspaceLabel;

  const openTerminal = useCallback(() => {
    if (!terminalId) return;
    router.push({ pathname: '/terminal/[terminalId]', params: { terminalId, instance: instance ?? '', title } });
  }, [router, terminalId, instance, title]);

  // The pane's Workspace folder, read-only (Files view; a file there can be attached back to an agent's draft).
  const filesWorkspace = filesServed && pane ? (located?.workspace ?? null) : null;
  const openFiles = useCallback(() => {
    if (!filesWorkspace) return;
    router.push({ pathname: '/files/[workspaceId]', params: { workspaceId: filesWorkspace.id, instance: instance ?? '', title: filesWorkspace.label } });
  }, [router, filesWorkspace, instance]);

  // The changes card opens the phone's read-only Git view of this pane's Workspace; a file link goes on to its diff.
  const reviewWorkspace = useMemo(() => (gitServed && pane ? (located?.workspace ?? null) : null), [gitServed, located, pane]);
  const review = useCallback(
    (path: string) => {
      if (!reviewWorkspace) return;
      const base = { workspaceId: reviewWorkspace.id, instance: instance ?? '' };
      router.push({ pathname: '/changes/[workspaceId]', params: { ...base, title: reviewWorkspace.label } });
      if (path) router.push({ pathname: '/changes/diff', params: { ...base, path } });
    },
    [router, reviewWorkspace, instance],
  );

  const attempts = useRef(
    createLaunchAttempts(newRequestId, pending?.body ? { id: pending.requestId, signature: JSON.stringify(pending.body) } : undefined),
  ).current;
  // Synchronous in-flight truth: the mount effect and the page's own send both must never run two launches.
  const inFlight = useRef(false);

  /** Runs the handed-over launch (first send or a resend after a failure); resolves once the pane is adopted. */
  const runLaunch = useCallback(
    async (text: string) => {
      if (!client || !instance || !pending?.target || !pending.kind || !pending.body) throw new Error(NOT_CONNECTED);
      if (inFlight.current) throw new Error('The agent is still starting — one moment.');
      const body = buildLaunchBody({ target: pending.target, kind: pending.kind, prompt: text });
      setLaunchError(null);
      inFlight.current = true;
      setLaunching(true);
      try {
        const reply = await client.launch(instance, { requestId: attempts.begin(body), ...body });
        attempts.settle(null);
        void queryClient.invalidateQueries({ queryKey: ['v3', 'tree', instance] });
        const route = launchRoute(reply, instance, title, true, text);
        if (route.pathname !== '/chat/[paneId]') {
          router.replace(route); // the Host turned it into a plain terminal
          return;
        }
        setAdopted({ paneId: reply.paneId, terminalId: reply.terminalId });
        if (reply.promptPending && text.trim()) {
          // The agent is blocked on its trust prompt: the text never went out. The page reloads with it as the
          // composer's draft (launchRoute's own convention), so the transcript hands the row back.
          setPromptPending(true);
        }
      } catch (failure) {
        attempts.settle(failure);
        setLaunchError(launchFailureMessage(failure));
        throw new Error(launchFailureMessage(failure));
      } finally {
        inFlight.current = false;
        setLaunching(false);
      }
    },
    [client, instance, pending, attempts, queryClient, router, title],
  );

  // The hand-off's launch: once, until it answers. A refusal lands on the page (outcome + settled row), and
  // sending again relaunches — the composer's send takes over. The in-flight guard keeps a retry's
  // `launchError` clear from re-triggering this effect beside it.
  useEffect(() => {
    if (!pending || adopted || launchError || inFlight.current) return undefined;
    void runLaunch(seedPrompt).catch(() => undefined);
    return undefined;
  }, [pending, adopted, launchError, runLaunch, seedPrompt]);

  const [pageState, setPageState] = useState<PageState | null>(null);
  const opsRef = useRef<ChatOps | null>(null);
  opsRef.current = {
    send: async (text, interrupt) => {
      if (pending) {
        if (inFlight.current) throw new Error('The agent is still starting — one moment.');
        await runLaunch(text);
        return;
      }
      if (!client || !instance || !pane) throw new Error(NOT_CONNECTED);
      await client.sendChat(instance, pane, interrupt ? { text, interrupt: true } : { text }).catch((e: unknown) => {
        throw sentence(e);
      });
    },
    stop: async () => {
      if (pending) throw new Error('Nothing is running yet.');
      if (!client || !instance || !pane) throw new Error(NOT_CONNECTED);
      await client.stopChat(instance, pane).catch((e: unknown) => {
        throw sentence(e);
      });
    },
    answer: async (request) => {
      if (!client || !instance || !pane) throw new Error(NOT_CONNECTED);
      await client.answerChat(instance, pane, request).catch((e: unknown) => {
        throw sentence(e);
      });
    },
    catalog: async () => {
      // While pending the page gets the folder's draft catalog — the same one compose's page reads.
      if (pending) {
        if (!client || !instance || !pending.target || !pending.kind) throw new Error(NOT_CONNECTED);
        return client.draftCatalog(instance, draftFolder(pending.target), pending.kind);
      }
      if (!client || !instance || !pane) throw new Error(NOT_CONNECTED);
      return client.chatCatalog(instance, pane);
    },
    openTerminal,
    older,
    files: async (token) => {
      if (pending) {
        if (!client || !instance || !pending.target) return [];
        return client.draftFiles(instance, draftFolder(pending.target), token);
      }
      if (!client || !instance || !pane) return [];
      return client.chatFiles(instance, pane, token);
    },
    canReview: () => reviewWorkspace !== null,
    review,
    canQueue: () => queueServed && pane !== null && !promptPending,
    queue: async (text) => {
      if (!client || !instance || !pane) throw new Error('The agent has not started yet.');
      await client.sendChat(instance, pane, { text, queue: true }).catch((e: unknown) => {
        throw sentence(e);
      });
    },
    cancelQueued: async () => {
      if (!client || !instance || !pane) throw new Error('The agent has not started yet.');
      await client.cancelQueued(instance, pane).catch((e: unknown) => {
        throw sentence(e);
      });
    },
    cancelQueuedItem: async (requestId) => {
      if (!client || !instance || !pane) throw new Error('The agent has not started yet.');
      await client.cancelQueuedItem(instance, pane, requestId).catch((e: unknown) => {
        throw sentence(e);
      });
    },
    canEdit: () => queueEditServed,
    editQueuedItem: async (requestId, text) => {
      if (!client || !instance || !pane) throw new Error('The agent has not started yet.');
      await client.editQueuedItem(instance, pane, requestId, text).catch((e: unknown) => {
        throw sentence(e);
      });
    },
    moveQueuedItem: async (requestId, to) => {
      if (!client || !instance || !pane) throw new Error('The agent has not started yet.');
      await client.moveQueuedItem(instance, pane, requestId, to).catch((e: unknown) => {
        throw sentence(e);
      });
    },
    subagent: async (id) => {
      if (!client || !instance || !pane) throw new Error('The agent has not started yet.');
      return client.chatSubagent(instance, pane, id).catch((e: unknown) => {
        throw sentence(e);
      });
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
      const upload = pane
        ? client.uploadAttachment(instance, pane, file)
        : client.uploadDraftAttachment(instance, file);
      return upload.catch((e: unknown) => {
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
    provider: () => (pending ? title : undefined),
  };
  const controller = useMemo(
    () =>
      createChatController(
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
        },
        setPageState,
      ),
    [conversationId],
  );
  useEffect(() => () => controller.dispose(), [controller]);

  // The handed-over prompt stands in as the first row until the pane's own transcript confirms it
  // (or hands it back as a draft when the agent asks for trust first).
  useEffect(() => {
    if (pending && seedPrompt && !promptPending) controller.prime(seedPrompt);
  }, [controller, pending, promptPending, seedPrompt]);
  useEffect(() => {
    if (promptPending) {
      controller.prime(''); // the row leaves the transcript; the reloaded page holds the draft instead
      setPageReady(false); // the reload hides behind the skeleton again
    }
  }, [controller, promptPending]);

  // One page-state story across the hand-off: while the launch runs (or before the pane's first frame) the
  // stream input is a stand-in, so the page keeps the transcript (echo row) or the invite — never a flash.
  useEffect(() => {
    controller.feed({
      phase: pane ? phase : 'live',
      frame,
      fallbackStatus: launchError ? 'idle' : (paneStatus ?? (pane ? undefined : 'working')),
      waiting: pending ? (seedPrompt && !promptPending ? false : true) : undefined,
      echoSettled: launchError ? true : undefined,
      ...(launchError ? { outcome: launchError } : {}),
    });
  }, [controller, phase, frame, paneStatus, pane, pending, seedPrompt, promptPending, launchError]);

  // The identity bar is a plain view inside the screen (headerShown: false): the native header's custom
  // subviews attach unreliably at mount on Android, and the custom-header container thrashes its height
  // against this screen's layout. A body view has none of that machinery — it just renders.
  const headerBar = (
    <XStack alignItems="center" height={56} paddingLeft={2} paddingRight={6} gap={2}>
      <IconButton as={ArrowLeft} tone="muted" label="Back" onPress={() => router.back()} />
      <ChatHeaderTitle title={heading} provider={provider} workspace={headerWorkspace} ago={ago} />
      <StatusSlot status={status ?? paneStatus ?? (launching ? 'working' : null)} />
      <HeaderMenu
        items={[
          ...(reviewWorkspace
            ? [{ key: 'changes', label: 'Changes', icon: GitCompare, onPress: () => review('') }]
            : []),
          ...(filesWorkspace ? [{ key: 'files', label: 'Files', icon: Folder, onPress: openFiles }] : []),
          ...(terminalId ? [{ key: 'terminal', label: 'Terminal', icon: Terminal, onPress: openTerminal }] : []),
          ...(assistantId
            ? [{ key: 'assistant', label: 'Assistant', icon: Bot, onPress: () => router.push({ pathname: '/assistants/[id]', params: { id: assistantId, manage: '1' } }) }]
            : []),
          { key: 'close', label: 'Close', icon: X, separated: true, onPress: () => router.back() },
        ]}
      />
    </XStack>
  );

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }} edges={['top', 'bottom']}>
        {headerBar}
        <ZoomIn>
          <KeyboardInset>
            {phase === 'gone' ? (
              <YStack flex={1} alignItems="center" justifyContent="center" gap="$3" padding="$6">
                <Text color={colors.text} fontSize={16} fontWeight="700">This pane is gone</Text>
                <Text color={colors.textMuted} fontSize={13} textAlign="center" lineHeight={19}>It was closed on the computer.</Text>
              </YStack>
            ) : (
              <View style={{ flex: 1 }}>
                {pageState && settled ? (
                  <Fade style={StyleSheet.absoluteFill}>
                    <ChatPageView
                      state={pageState}
                      conversationId={conversationId}
                      seedDraft={promptPending ? seedPrompt : seedDraft}
                      openSubagent={openSubagent}
                      onCall={controller.call}
                      onReady={() => setPageReady(true)}
                    />
                  </Fade>
                ) : null}
                {!pageReady ? (
                  <Fade style={StyleSheet.absoluteFill}>
                    <YStack flex={1} backgroundColor={colors.canvas} padding={spacing.screen} gap={14}>
                      <Skeleton width="38%" height={14} />
                      <Skeleton width="86%" height={14} />
                      <Skeleton width="64%" height={14} />
                      <Skeleton width="72%" height={14} />
                    </YStack>
                  </Fade>
                ) : null}
              </View>
            )}
            {phase === 'reconnecting' ? (
              <Fade>
                <Text color={colors.textSubtle} fontSize={11} textAlign="center" paddingVertical="$1">Reconnecting…</Text>
              </Fade>
            ) : null}
          </KeyboardInset>
        </ZoomIn>
      </SafeAreaView>
    </>
  );
}
