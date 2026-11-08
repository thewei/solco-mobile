// [INPUT]: a pane id (+ instance, terminal id, title, seed draft) from Home, or a `pending-<requestId>` hand-off
//          from Home/compose (target folder, agent kind, the prompt) whose launch this screen then runs, or an
//          `assistant-<id>` window (an Assistant whose Coordinator is not running: its previous conversation, read-only,
//          from the Mac's catalog), and the Go Host v3 chat stream once the real pane exists.
// [OUTPUT]: the desktop's own Chat page (solco/frontend, embedded as `generated/chat-page.ts`) over this pane's
//           conversation: turns, thinking/tool summary rows, changes card, Tasks tray, Question dock, composer
//           (Send / Stop / cut in). A pending hand-off shows the sent prompt as the first transcript row over a
//           working shimmer while the launch is in flight, then hands over to the pane's own stream — the page
//           never waits for the first frame to exist. The phone side is `features/chat-web` (state adapter +
//           `chat.*` bridge) and `components/chat/chat-page-view`; this screen wires the Host stream, the launch
//           and the operations to them.
// [POS]: P2/P3 Chat surface of the phone client. An Assistant's window is the same page: the history is its first frame (idle, so
//        the composer is on) and the first send starts the Coordinator, waits for its pane, sends once through the ordinary
//        chat path and adopts the pane in place — the conversation never changes identity, so there is no reload or flash. While it
//        shows history it also watches for a Coordinator started elsewhere and adopts that pane, pages "Earlier messages" by asking the
//        Host for a longer read, and falls back to history when the pane goes (a Stop on the Mac, the daemon's idle sleep). The
//        lifecycle is invisible here: the header says Sleeping / Ready / Working, a send wakes it, and a window opened on a Coordinator
//        the core put to sleep itself (`stopReason: idle`) wakes it once in the background; Start / Stop / Restart live only under
//        Advanced on the Assistant page. Navigation is client-local; nothing here moves the Mac's focus.
//        A refusal from the Host reaches the page as the sentence it maps to, never bypassed. A failed start
//        keeps the message row and says why above the composer; sending again relaunches (a fresh requestId,
//        except a transport failure, which replays the same one). The app bar (designs/mobile-t3-redesign `chat`) is the shared `Screen` bar: back, the
//        chat's title over `Workspace · host` (an Assistant's second line is its one-word state; while a launch is still in flight the
//        handed-over target names the Workspace), a Files button and one ⋮ menu (Open terminal, Open changes + its file count, then — in
//        an Assistant's window — Memory, Assistant and All chats). An Assistant's window also carries the dock above the page (approvals,
//        result cards). The body is the shared Chat page; an unserved Chat or a closed pane is an explained state with a way out.
// [PROTOCOL]: 变更时更新此头部，然后检查 ../CLAUDE.md
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text } from 'tamagui';

import { AssistantDock } from '@/components/assistant-dock';
import { ChatPageView } from '@/components/chat/chat-page-view';
import { EmptyState } from '@/components/empty-state';
import { KeyboardInset } from '@/components/keyboard-inset';
import { Menu, MenuItem, MenuRule } from '@/components/menu';
import { Fade, Skeleton } from '@/components/motion';
import { Screen } from '@/components/screen';
import { refusalText } from '@/features/chat/refusals';
import { createChatController, type ChatOps } from '@/features/chat-web/controller';
import { COORDINATOR_CHAT_PREFIX, coordinatorHistoryFrame, isCoordinatorChatId } from '@/features/chat-web/coordinator-history';
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
import { flattenPanes, paneRoute, paneTitle } from '@/features/host/pane-model';
import { adoptableCoordinatorPane, COORDINATOR_AGENT_UNAVAILABLE, conversationWord, coordinatorStartAgent, sendWhenReady, waitForCoordinatorPane } from '@/features/host/personal-agent-model';
import { useAssistantDetail, useBootstrapV3, useChatStream, useCoordinatorChat, useGitStatus, useHostInstance, useTreeV3 } from '@/features/host/queries-v3';
import { HostV3Error } from '@/lib/host-client-v3';
import { pickAttachment } from '@/lib/pick-attachment';
import { useAfterTransition } from '@/lib/use-after-transition';
import { useHostV3 } from '@/lib/host-v3-provider';
import { IconAlertTriangle, IconDotsVertical, IconFolder } from '@/theme/glyphs';
import { colors, radii, spacing, type as typeScale } from '@/theme/tokens';

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
  const { client, connection } = useHostV3();
  const params = useLocalSearchParams<{ paneId: string; instance?: string; terminalId?: string; title?: string; draft?: string; subagent?: string; assistant?: string } & Parameters<typeof pendingOf>[0]>();
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
  const paneIdParam = first(params.paneId);
  // An Assistant whose Coordinator is not running: this screen is its chat window (no pane yet).
  const offlineId = isCoordinatorChatId(paneIdParam) ? paneIdParam.slice(COORDINATOR_CHAT_PREFIX.length) : '';
  // Opened from an Assistant's contact: its page stays one tap away.
  const assistantId = first(params.assistant) || offlineId;
  const title = first(params.title) || 'Agent';
  const { instance: defaultInstance, bootstrap: instanceBootstrap } = useHostInstance();
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
  const pane = adopted?.paneId ?? (pending || offlineId ? null : paneIdParam);
  const terminalId = adopted?.terminalId ?? first(params.terminalId);

  const bootstrap = useBootstrapV3();
  const attachServed = bootstrap.data?.capabilities.attachments === true;
  // Dictation records in the WebView (getUserMedia) and the Mac transcribes: native hosts only, never the Web/PWA twin.
  const voiceServed = bootstrap.data?.capabilities.voice === true && Platform.OS !== 'web';
  const queueServed = bootstrap.data?.capabilities.queue === true;
  const queueEditServed = bootstrap.data?.capabilities.queueEdit === true;
  const gitServed = bootstrap.data?.capabilities.git === true;
  const filesServed = bootstrap.data?.capabilities.files === true;
  // The Coordinator's previous conversation, looked at again while no pane carries the chat.
  const historyServed = bootstrap.data?.capabilities.personalAgentCoordinatorChat === true;
  // "Earlier messages" of that window = a longer read of the same conversation (pages walked up so far).
  const [olderPages, setOlderPages] = useState(0);
  const history = useCoordinatorChat(offlineId, offlineId !== '' && historyServed && !pane, olderPages);
  const historyFrame = useMemo(() => (history.data ? coordinatorHistoryFrame(history.data) : null), [history.data]);
  const manageServed = bootstrap.data?.capabilities.personalAgentManage === true;
  const memoryServed = bootstrap.data?.capabilities.personalAgentMemory === true;
  // While the window shows history it keeps asking the core whether the Coordinator came up elsewhere (the Mac, another phone).
  // The same read feeds the dock above the page (approvals, result cards), so it also runs — slower — while a pane carries the chat.
  const windowDetail = useAssistantDetail(offlineId, offlineId !== '' && !launching, pane ? 10_000 : 5000);
  const canDecide = bootstrap.data?.capabilities.personalAgentApprove === true;
  const { phase, frame, older: olderOnPane } = useChatStream(instance, pane);
  const older = useCallback(() => {
    if (pane) olderOnPane();
    else setOlderPages((pages) => Math.min(pages + 1, 4)); // the Host's window stops at four pages up
  }, [pane, olderOnPane]);
  const tree = useTreeV3(instance || null);
  // One scan of the tree answers everything the header shows: the pane, its Workspace, its agent's meta.
  const located = useMemo(
    () => (pane ? flattenPanes(tree.data?.workspaces ?? []).find((item) => item.pane.paneId === pane) ?? null : null),
    [tree.data, pane],
  );
  const status = frame?.agentStatus;
  const paneStatus = located?.pane.agent?.status;
  // An Assistant's conversation is titled by the Assistant: the pane's own title is the launch prompt.
  const heading = (assistantId ? title : '') || (located ? paneTitle(located.pane) : '') || title;
  const workspaceLabel = located?.workspace.label ?? '';
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
  // An Assistant's header says one word about its conversation, the desktop page's own words (Sleeping, Ready, Working, and only a real problem by name).
  const assistantWord = conversationWord({
    paused: windowDetail.data ? windowDetail.data.assistant.status !== 'active' : false,
    launching,
    paneOpen: Boolean(pane),
    working: (status ?? paneStatus) === 'working',
    coordinatorState: windowDetail.data?.coordinator.state,
  });

  const openTerminal = useCallback(() => {
    if (!terminalId) return;
    router.push({ pathname: '/terminal/[terminalId]', params: { terminalId, instance: instance ?? '', title: headerWorkspace || title } });
  }, [router, terminalId, instance, title, headerWorkspace]);

  // The pane's Workspace folder, read-only (Files view; a file there can be attached back to an agent's draft).
  const filesWorkspace = filesServed && pane ? (located?.workspace ?? null) : null;
  const openFiles = useCallback(() => {
    if (!filesWorkspace) return;
    router.push({ pathname: '/files/[workspaceId]', params: { workspaceId: filesWorkspace.id, instance: instance ?? '', title: filesWorkspace.label } });
  }, [router, filesWorkspace, instance]);

  // The changes card opens Review for this pane's Workspace; a file link opens it with that file's diff already open.
  const reviewWorkspace = useMemo(() => (gitServed && pane ? (located?.workspace ?? null) : null), [gitServed, located, pane]);
  const review = useCallback(
    (path: string) => {
      if (!reviewWorkspace) return;
      router.push({ pathname: '/changes/review', params: { workspaceId: reviewWorkspace.id, instance: instance ?? '', title: reviewWorkspace.label, ...(path ? { path } : {}) } });
    },
    [router, reviewWorkspace, instance],
  );
  // The ⋮ menu's "Open changes" is the Workspace's Git controls page; the pill's Review and a file link go straight to the review.
  const openChanges = useCallback(() => {
    if (!reviewWorkspace) return;
    router.push({ pathname: '/changes/[workspaceId]', params: { workspaceId: reviewWorkspace.id, instance: instance ?? '', title: reviewWorkspace.label } });
  }, [router, reviewWorkspace, instance]);
  // The pill above the composer and the menu's "N files" read one Git status: once when the chat opens and again each time the agent
  // stops working (that is when its edits land). A Commit made on the Changes screen sets this same query, so the pill follows it.
  const changes = useGitStatus(instance, reviewWorkspace?.id ?? '', reviewWorkspace !== null);
  const changedCount = changes.data?.repo ? changes.data.files.length : undefined;
  const refetchChanges = changes.refetch;
  const lastAgentStatus = useRef(paneStatus);
  useEffect(() => {
    const was = lastAgentStatus.current;
    lastAgentStatus.current = paneStatus;
    if (was === 'working' && paneStatus !== 'working' && reviewWorkspace) void refetchChanges();
  }, [paneStatus, reviewWorkspace, refetchChanges]);

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

  // The Assistant window's first send: start the Coordinator if it is not up, wait for its pane, send once, adopt the pane.
  // The sent text stands as a row meanwhile (`startText`); a failure settles it with the reason and the next send tries again
  // — nothing here ever resends by itself, so an uncertain delivery is never doubled.
  const [startText, setStartText] = useState('');
  const startConversation = useCallback(
    async (text: string) => {
      if (!client || !instance || !offlineId) throw new Error(NOT_CONNECTED);
      if (inFlight.current) throw new Error('The Coordinator is still starting — one moment.');
      inFlight.current = true;
      setLaunching(true);
      setLaunchError(null);
      if (text) setStartText(text);
      try {
        const detail = await client.assistantDetail(offlineId).catch((e: unknown) => {
          throw sentence(e);
        });
        if (detail.assistant.status !== 'active') throw new Error('Paused — resume it before sending.');
        if (detail.coordinator.state !== 'starting' && detail.coordinator.state !== 'ready') {
          const agent = coordinatorStartAgent(detail.agents);
          if (!agent) throw new Error(COORDINATOR_AGENT_UNAVAILABLE);
          await client.startCoordinator(newRequestId(), offlineId, agent).catch((e: unknown) => {
            throw sentence(e);
          });
        }
        const found = await waitForCoordinatorPane({
          read: async () => {
            const [now, workspaces] = await Promise.all([client.assistantDetail(offlineId), client.tree(instance)]);
            return { coordinator: now.coordinator, workspaces: workspaces.workspaces };
          },
          instance,
          chatServed: true,
          sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
          now: Date.now,
        });
        // A restart has nothing to say: the pane is adopted as soon as it is addressable.
        if (text) {
          await sendWhenReady({
            send: () => client.sendChat(instance, found.paneId, { text }).then(() => undefined),
            sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
            now: Date.now,
          }).catch((e: unknown) => {
            throw sentence(e);
          });
        }
        void queryClient.invalidateQueries({ queryKey: ['v3', 'tree', instance] });
        setAdopted({ paneId: found.paneId, terminalId: found.terminalId });
      } catch (failure) {
        const message = failure instanceof Error ? failure.message : String(failure);
        setLaunchError(message);
        throw new Error(message);
      } finally {
        inFlight.current = false;
        setLaunching(false);
      }
    },
    [client, instance, offlineId, queryClient],
  );

  const [pageState, setPageState] = useState<PageState | null>(null);
  const opsRef = useRef<ChatOps | null>(null);
  opsRef.current = {
    send: async (text, interrupt) => {
      if (pending) {
        if (inFlight.current) throw new Error('The agent is still starting — one moment.');
        await runLaunch(text);
        return;
      }
      if (offlineId && !pane) {
        await startConversation(text);
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
    changedFiles: () => changedCount,
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
          changedFiles: () => opsRef.current!.changedFiles?.(),
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
    if (startText) controller.prime(startText);
  }, [controller, startText]);
  useEffect(() => {
    if (promptPending) {
      controller.prime(''); // the row leaves the transcript; the reloaded page holds the draft instead
      setPageReady(false); // the reload hides behind the skeleton again
    }
  }, [controller, promptPending]);

  // The Coordinator was stopped (on the Mac, or from the ⋯ menu) while this window carried its pane: the window goes back to the
  // Assistant's history (read afresh) instead of a dead pane, and the next send starts it again.
  const fellBackAt = useRef(0);
  const backToHistory = useCallback(() => {
    fellBackAt.current = Date.now();
    queryClient.removeQueries({ queryKey: ['v3', 'personal-agent', 'coordinator-chat', offlineId] });
    setAdopted(null);
    setStartText('');
    setOlderPages(0);
    controller.prime('');
  }, [offlineId, queryClient, controller]);
  useEffect(() => {
    if (!offlineId || !adopted || phase !== 'gone' || launching) return;
    backToHistory();
  }, [offlineId, adopted, phase, launching, backToHistory]);

  // …and the other way: a Coordinator that came up elsewhere (the Mac, another phone) while this window shows history is carried in
  // place — only from a read newer than the last fall-back, so a stale "ready" never revives a pane that was just stopped.
  useEffect(() => {
    if (!offlineId || pane || launching || launchError || !instance || !windowDetail.data) return;
    if (windowDetail.dataUpdatedAt <= fellBackAt.current) return;
    const live = adoptableCoordinatorPane(windowDetail.data.coordinator, tree.data?.workspaces ?? [], instance, true);
    if (live) setAdopted({ paneId: live.paneId, terminalId: live.terminalId });
  }, [offlineId, pane, launching, launchError, instance, windowDetail.data, windowDetail.dataUpdatedAt, tree.data]);

  // An Assistant window opened on a Coordinator the core put to sleep by itself wakes it in the background, so it is up by the time the
  // first word is typed. Once per opening: a sleep while the window stays open is not undone, and a person's Stop (no stopReason) is
  // never revived by merely looking. A failed wake settles above the composer like any failed start; the next send tries again.
  const warmed = useRef(false);
  useEffect(() => {
    if (warmed.current || !offlineId || pane || launching || launchError || !instance || !manageServed) return;
    if (!windowDetail.isFetchedAfterMount || !windowDetail.data) return;
    warmed.current = true;
    const { assistant, coordinator } = windowDetail.data;
    if (assistant.status === 'active' && coordinator.state === 'stopped' && coordinator.stopReason === 'idle') void startConversation('').catch(() => undefined);
  }, [offlineId, pane, launching, launchError, instance, manageServed, windowDetail.isFetchedAfterMount, windowDetail.data, startConversation]);

  // One page-state story across the hand-off: while the launch runs (or before the pane's first frame) the
  // stream input is a stand-in, so the page keeps the transcript (echo row) or the invite — never a flash.
  useEffect(() => {
    controller.feed({
      // An Assistant window shows its history until the adopted pane's own first frame replaces it.
      phase: pane ? phase : offlineId && history.isLoading ? 'connecting' : 'live',
      frame: frame ?? (offlineId ? historyFrame : null),
      fallbackStatus: launchError ? 'idle' : (paneStatus ?? (pane ? undefined : offlineId && !launching ? 'idle' : 'working')),
      waiting: pending ? (seedPrompt && !promptPending ? false : true) : undefined,
      draft: !pane,
      echoSettled: launchError ? true : undefined,
      ...(launchError ? { outcome: launchError } : {}),
    });
  }, [controller, phase, frame, paneStatus, pane, pending, seedPrompt, promptPending, launchError, offlineId, history.isLoading, historyFrame, launching, changedCount]);

  const [menuOpen, setMenuOpen] = useState(false);
  const hostName = connection?.name || bootstrap.data?.hostName || '';
  const subtitle = assistantId ? assistantWord : [headerWorkspace, hostName].filter(Boolean).join(' · ');
  // A Host that does not serve Chat (a stale link, a notification) is told so, with the terminal as the way on.
  const chatUnavailable = instanceBootstrap.data !== undefined && instanceBootstrap.data.capabilities.chat !== true && !offlineId && !pending;
  const choose = (action: () => void) => () => {
    setMenuOpen(false);
    action();
  };

  let body: React.ReactNode;
  if (chatUnavailable) {
    body = (
      <EmptyState
        icon={IconAlertTriangle}
        title="Chat isn’t available here"
        text={`${hostName || 'This computer'} doesn’t serve Chat to the phone yet. The terminal still works.`}
        action={terminalId ? 'Open terminal' : undefined}
        onAction={openTerminal}
      />
    );
  } else if (phase === 'gone') {
    body = <EmptyState icon={IconAlertTriangle} title="This pane is gone" text="It was closed on the computer." action="Back" onAction={() => router.back()} />;
  } else {
    body = (
      <View style={{ flex: 1 }}>
        {offlineId && manageServed ? (
          <AssistantDock
            detail={windowDetail.data}
            instance={instance ?? ''}
            workspaces={tree.data?.workspaces ?? []}
            canDecide={canDecide}
            onOpenPane={(target) => router.push(paneRoute(target, instance ?? '', instanceBootstrap.data?.capabilities.chat === true))}
            onDetails={() => router.push({ pathname: '/assistants/[id]', params: { id: offlineId, manage: '1' } })}
          />
        ) : null}
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
              <View accessibilityRole="progressbar" accessibilityLabel="Loading chat" style={{ flex: 1, gap: 14, padding: spacing.screen, backgroundColor: colors.canvas }}>
                <View style={{ alignSelf: 'flex-end', width: '72%' }}>
                  <Skeleton height={64} radius={radii.bubble} />
                </View>
                <Skeleton width="90%" height={16} />
                <Skeleton width="76%" height={16} />
                <Skeleton width="58%" height={16} />
                <Skeleton width="100%" height={96} radius={radii.sm} />
              </View>
            </Fade>
          ) : null}
        </View>
      </View>
    );
  }

  // An empty state is centred on the whole card, as in the design; only the chat body clears the navigation bar.
  const bodyEdges = chatUnavailable || phase === 'gone' ? [] : (['bottom'] as const);

  return (
    <Screen
      back
      title={heading}
      subtitle={subtitle || undefined}
      actions={[
        ...(filesWorkspace ? [{ icon: IconFolder, label: 'Files', onPress: openFiles }] : []),
        { icon: IconDotsVertical, label: 'More', onPress: () => setMenuOpen(true) },
      ]}>
      <SafeAreaView edges={bodyEdges} style={{ flex: 1, backgroundColor: colors.canvas }}>
        <Fade style={{ flex: 1 }}>
          <KeyboardInset>
            {body}
            {phase === 'reconnecting' ? (
              <Fade>
                <Text color={colors.textMuted} fontSize={typeScale.caption.fontSize} lineHeight={typeScale.caption.lineHeight} textAlign="center" paddingVertical={4}>Reconnecting…</Text>
              </Fade>
            ) : null}
          </KeyboardInset>
        </Fade>
      </SafeAreaView>
      <Menu visible={menuOpen} onClose={() => setMenuOpen(false)}>
        {terminalId ? <MenuItem label="Open terminal" onPress={choose(openTerminal)} /> : null}
        {reviewWorkspace ? <MenuItem label="Open changes" detail={changedCount === undefined ? undefined : `${changedCount} ${changedCount === 1 ? 'file' : 'files'}`} onPress={choose(openChanges)} /> : null}
        {assistantId && (terminalId || reviewWorkspace) ? <MenuRule /> : null}
        {assistantId && memoryServed ? <MenuItem label="Memory" onPress={choose(() => router.push({ pathname: '/assistants/memory/[id]', params: { id: assistantId } }))} /> : null}
        {assistantId ? <MenuItem label="Assistant" onPress={choose(() => router.push({ pathname: '/assistants/[id]', params: { id: assistantId, manage: '1' } }))} /> : null}
        {assistantId ? <MenuItem label="All chats" onPress={choose(() => router.navigate('/'))} /> : null}
      </Menu>
    </Screen>
  );
}
