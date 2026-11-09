// [INPUT]: a PinnedTransport (route=lan) or one HostConnectionV3 whose `relay` names the route
//          (route=relay: plain JS fetch/WebSocket over the relay; transport may be null).
// [OUTPUT]: pairWithHost, createHostClientV3 → { bootstrap, tree, peek, openEvents, openTerminal },
//           launch (start a new session), chat / chatCatalog / openChat / sendChat / stopChat / answerChat (Chat + Herdr-gated send and card answers; SC-06 Host chat_delta exact seq merge, missing seq triggers a single snapshot resync),
//           quota (the Mac's agent-quota page), sessions (the Mac's session catalog, read-only), * (the Mac's local Cursor GUI, read-only), HostV3Error (kind: unauthorized | pin | http | protocol | transport).
// [POS]: The only caller of the Go Host `/api/v3`. Every response is Zod-validated at this edge;
//        screens and state see typed DTOs and one error family. No Herdr types leak through.
//        Two routes, one client: route=relay speaks ordinary HTTPS to the explicitly registered
//        relay (`<r>/c/<secret>`, Bearer header; WS token in the query, no subprotocol) — the relay
//        URL is CA-signed, there is nothing to pin. route=lan keeps the native pinned transport.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
// Invariants: every LAN request carries the pinned fingerprint (the transport refuses any other
// certificate); a 401 is "this device was revoked or the Host was reset" and is its own kind so
// callers can drop the connection; terminal input is encoded by terminal-protocol-v3, which
// refuses what the Host would refuse.
import { z } from 'zod';
import { applyHostChatDelta } from '@/features/chat-web/host-delta';

import {
  V3_API_PREFIX,
  V3_BEARER_SUBPROTOCOL,
  V3_CLOSE_NO_CONVERSATION,
  V3_CLOSE_TERMINAL_GONE,
  chatAckSchema,
  p2pIceSchema,
  p2pSessionSchema,
  type P2PIceServer,
  type P2PSessionAnswer,
  attachReplySchema,
  attachRequestSchema,
  chatCatalogSchema,
  chatFilesSchema,
  chatWireFrameSchema,
  chatResponseSchema,
  subagentViewSchema,
  bootstrapV3Schema,
  launchRequestSchema,
  fileContentSchema,
  filesListSchema,
  filesSearchSchema,
  gitDiffSchema,
  gitStatusSchema,
  gitWriteResultSchema,
  deviceConnectResponseSchema,
  type DeviceConnectResponse,
  gitCommitRequestSchema,
  quotaSchema,
  automationsSchema,
  feedbackAnswerRequestSchema,
  feedbackCleanupRequestSchema,
  feedbackCleanupResultSchema,
  feedbackDeleteRequestSchema,
  feedbackDeleteResultSchema,
  feedbackRetentionRequestSchema,
  feedbackSnapshotSchema,
  type FeedbackAnswerRequest,
  type FeedbackSnapshot,
  automationDetailSchema,
  automationWriteSchema,
  type AutomationDetail,
  type AutomationFields,
  type AutomationOp,
  assistantOverviewSchema,
  assistantDetailSchema,
  coordinatorChatSchema,
  type CoordinatorChat,
  assistantApprovalsSchema,
  assistantInboxSchema,
  groupsListSchema,
  groupFeedResponseSchema,
  instructionsResponseSchema,
  assistantActivityPageSchema,
  assistantActivityAckSchema,
  coordinatorReportResponseSchema,
  enrollResponseSchema,
  systemPushStatusSchema,
  type SystemPushStatus,
  type CoordinatorReport,
  type AssistantActivityPage,
  notesResponseSchema,
  proactivityResponseSchema,
  mcpResponseSchema,
  runtimeResponseSchema,
  groupDeletedSchema,
  groupReceiptSchema,
  groupPostResponseSchema,
  groupMessageRequestSchema,
  type Group,
  type GroupFeed,
  type Instructions,
  type Notes,
  type NotesFileName,
  type Proactivity,
  type ProactivityInput,
  type McpView,
  type Runtime,
  type GroupMessageRequest,
  type GroupPostResult,
  assistantReceiptSchema,
  assistantGoalReceiptSchema,
  assistantTaskReceiptSchema,
  assistantCoordinatorReceiptSchema,
  assistantApprovalReceiptSchema,
  assistantDecisionRequestSchema,
  assistantCommitmentInputSchema,
  type Assistant,
  type AssistantApproval,
  type AssistantCommitmentInput,
  type AssistantDetail,
  type AssistantGoal,
  type AssistantGoalAction,
  type AssistantOverview,
  type AssistantInboxItem,
  type AssistantTaskAction,
  type AssistantTaskReceipt,
  type AssistantCoordinator,
  sessionsSchema,
  trashAnswerSchema,
  trashListSchema,
  launchResponseSchema,
  continueResponseSchema,
  voiceRequestSchema,
  voiceResponseSchema,
  rdAnswerSchema,
  rdInfoSchema,
  rdOfferSchema,
  type RdAnswer,
  type RdInfo,
  type RdOffer,
  errorBodyV3Schema,
  eventMessageSchema,
  pairResponseSchema,
  peekSchema,
  terminalHistorySchema,
  treeV3Schema,
  type AttachRequest,
  type BootstrapV3,
  type ChatCatalog,
  type ChatFrame,
  type ChatResponse,
  type SubagentView,
  type ChatAnswerRequest,
  type ChatSendRequest,
  type EventMessage,
  type LaunchRequest,
  type FileContent,
  type FilesList,
  type FilesSearch,
  type GitDiff,
  type GitStatus,
  type GitWriteResult,
  type GitCommitRequest,
  type GitSyncOp,
  type Quota,
  type Automations,
  type Sessions,
  type TrashAnswer,
  type TrashList,
  type ContinueResponse,
  type VoiceRequest,
  type VoiceResponse,
  type LaunchResponse,
  type Peek,
  type TerminalHistory,
  type TreeV3,
} from '@/contracts/host-v3';
import type { HostConnectionV3 } from '@/lib/host-connection-v3';
import { hostConnectionBaseUrl, relayBaseUrl } from '@/lib/host-connection-v3';
import type { P2PRequestInit } from '@/lib/p2p-tunnel';
import { pairRequestBody, pairTargetBaseUrl, type PairTarget } from '@/lib/pairing-v3';
import {
  PinMismatchError,
  PinnedTransportError,
  type PinnedResponse,
  type PinnedSocket,
  type PinnedSocketHandlers,
  type PinnedTransport,
} from '@/lib/pinned-transport';
import {
  ENCODED_PING,
  clampGrid,
  createFrameAssembler,
  encodeInput,
  encodeResize,
  encodeScroll,
  encodeMouse,
  encodeTap,
  terminalStreamPath,
  type TerminalEvent,
  type TerminalGrid,
  type TerminalInput,
} from '@/lib/terminal-protocol-v3';

/** `HostV3Error.code` of a gateway answer that is not the Host's: the relay has no Mac behind the code. */
export const RELAY_OFFLINE_CODE = 'relay_offline';

export type HostV3ErrorKind = 'unauthorized' | 'pin' | 'http' | 'protocol' | 'transport';

export class HostV3Error extends Error {
  readonly kind: HostV3ErrorKind;
  readonly status?: number;
  readonly code?: string;
  constructor(kind: HostV3ErrorKind, message: string, extra: { status?: number; code?: string } = {}) {
    super(message);
    this.name = 'HostV3Error';
    this.kind = kind;
    this.status = extra.status;
    this.code = extra.code;
  }
}

/**
 * A route probe that was refused with 401 still found the Host: the way in works and the Host answered, only
 * not in this phone's favour (revoked or reset). That is not a dead route; the app's own queries turn it into
 * "forget this Mac". A pin mismatch (another machine on that address) or a relay "offline" is a dead route.
 */
export function routeAnswered(error: unknown): boolean {
  return error instanceof HostV3Error && error.kind === 'unauthorized';
}

function describeFailure(error: unknown): HostV3Error {
  if (error instanceof HostV3Error) return error;
  if (error instanceof PinMismatchError) {
    return new HostV3Error('pin', "This is not the computer that was paired (its certificate changed). Pair again from Solco's Settings.");
  }
  const message = error instanceof PinnedTransportError || error instanceof Error ? error.message : String(error);
  return new HostV3Error('transport', message);
}

function parseBody<T>(schema: z.ZodType<T>, body: string, what: string): T {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw new HostV3Error('protocol', `${what}: the Host sent something that is not JSON`);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new HostV3Error('protocol', `${what}: unexpected response shape`);
  return parsed.data;
}

function failureFromResponse(status: number, body: string, what: string): HostV3Error {
  let code: string | undefined;
  let message: string | undefined;
  try {
    const parsed = errorBodyV3Schema.safeParse(JSON.parse(body));
    if (parsed.success) {
      code = parsed.data.error.code;
      message = parsed.data.error.message;
    }
  } catch {
    // not JSON: keep the generic message
  }
  const kind: HostV3ErrorKind = status === 401 ? 'unauthorized' : 'http';
  // A gateway status without the Host's own error body did not come from the Host: through the relay it is
  // "no Mac is connected under this code" (alma-relay answers 502 {"error": "<text>"}), and no Solco Host
  // ever answers 502–504 without a coded body. A reason of its own, because the way in works and the Mac is not there.
  if (code === undefined && status >= 502 && status <= 504) {
    return new HostV3Error(kind, message ?? 'The computer is not connected to the relay', { status, code: RELAY_OFFLINE_CODE });
  }
  return new HostV3Error(kind, message ?? `${what}: the Host answered ${status}`, { status, code });
}

/** route=relay has no headers and no subprotocols: the device token travels in the query. */
function relayTokenQuery(url: string, token: string): string {
  return `${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
}

const RELAY_TIMEOUT_MS = 15_000;

type RelayRequestInit = {
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
};

/**
 * route=relay HTTP: the JS layer's own fetch against the relay's public HTTPS endpoint (a normal
 * CA-signed certificate — nothing to pin). Mirrors PinnedResponse so one client parses both routes.
 */
async function relayRequest(init: RelayRequestInit): Promise<PinnedResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? RELAY_TIMEOUT_MS);
  try {
    const response = await fetch(init.url, { method: init.method, headers: init.headers, body: init.body, signal: controller.signal });
    return { status: response.status, headers: {}, body: await response.text() };
  } catch (error) {
    if (controller.signal.aborted) throw new Error('timed out');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** route=relay WebSocket: plain global WebSocket, token in the query, no subprotocol. */
function relayOpenSocket(url: string, handlers: PinnedSocketHandlers): PinnedSocket {
  const socket = new WebSocket(url);
  socket.binaryType = 'arraybuffer';
  let closed = false;
  socket.onopen = () => handlers.onOpen?.();
  socket.onmessage = (event) => {
    if (closed) return;
    const data: unknown = event.data;
    if (typeof data === 'string') handlers.onText?.(data);
    else if (data instanceof ArrayBuffer) handlers.onBinary?.(new Uint8Array(data));
  };
  socket.onerror = () => handlers.onError?.(new PinnedTransportError('ERR_SOCKET_FAILED', 'the relay connection failed'));
  socket.onclose = (event) => {
    if (closed) return;
    closed = true;
    handlers.onClose?.({ code: event.code, reason: event.reason ?? '' });
  };
  return {
    sendText: (text) => socket.send(text),
    sendBinary: (bytes) => socket.send(bytes),
    close: (code, reason) => {
      if (closed) return;
      closed = true;
      socket.close(code ?? 1000, reason ?? '');
    },
  };
}

/**
 * Trade the one-time code in a pairing link for a device token. route=relay posts through the
 * explicitly registered relay endpoint with plain fetch (trust root: the user physically scanned
 * the QR on the Mac's screen plus the 6-minute one-time code); route=lan needs the pinned
 * transport and refuses without it — never an unpinned direct fetch.
 */
export async function pairWithHost(
  transport: PinnedTransport | null,
  target: PairTarget,
  deviceName: string,
  clientKey?: string,
  tunnel?: PinnedTransport | null,
  /** Which way the pair really went, so the new card starts on that route instead of failing once first. */
  onVia?: (via: 'direct' | 'tunnel' | 'relay') => void,
): Promise<HostConnectionV3> {
  const what = 'pairing';
  try {
    // clientKey (the phone's tunnel node public key, injected by the caller) rides every pair: the
    // Mac binds it at pair time so the built-in tunnel admits this phone later without a live
    // pairing window (absent = no bridge, no tunnel).
    const body = pairRequestBody(target, deviceName, clientKey);
    let response: PinnedResponse | undefined;
    if (target.relay) {
      response = await relayRequest({
        url: `${target.relay.url}/c/${target.relay.secret}${V3_API_PREFIX}/pair`,
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      });
      onVia?.('relay');
    } else {
      // Direct first (fastest, and the LAN pair needs no tunnel); when the Mac's address is
      // unreachable from here — the phone on cellular, the Mac elsewhere — the pair itself goes
      // through the built-in tunnel, exactly like every later request will.
      let directError: unknown = null;
      if (transport) {
        try {
          response = await transport.request({
            url: `${pairTargetBaseUrl(target)}${V3_API_PREFIX}/pair`,
            fingerprint: target.fingerprint,
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body,
            timeoutMs: 3_000,
          });
          onVia?.('direct');
        } catch (error) {
          directError = error;
        }
      }
      if (response === undefined) {
        if (!tunnel) {
          if (directError) throw describeFailure(directError);
          throw new HostV3Error(
            'transport',
            'This build has no certificate-pinned connection (Android only), so it cannot pair safely.',
          );
        }
        response = await tunnel.request({
          url: `${pairTargetBaseUrl(target)}${V3_API_PREFIX}/pair`,
          fingerprint: target.fingerprint,
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
          timeoutMs: 30_000,
        });
        onVia?.('tunnel');
      }
    }
    if (response.status !== 200) throw failureFromResponse(response.status, response.body, what);
    const { deviceId, token } = parseBody(pairResponseSchema, response.body, what);
    return {
      host: target.host,
      port: target.port,
      fingerprint: target.fingerprint,
      token,
      deviceId,
      name: target.hostName || undefined,
      ...(target.relay ? { relay: target.relay } : {}),
      ...(target.tailcat ? { tailcat: target.tailcat } : {}),
    };
  } catch (error) {
    throw describeFailure(error);
  }
}

export interface EventsHandlers {
  onMessage(message: EventMessage): void;
  onClose(event: { code: number; reason: string }): void;
  onError?(error: HostV3Error): void;
}

export interface TerminalHandlers {
  onEvent(event: TerminalEvent): void;
  /** `gone` = the Host closed with 4404: the terminal no longer exists, do not reconnect. */
  onClose(event: { code: number; reason: string; gone: boolean }): void;
  onError?(error: HostV3Error): void;
}

export interface TerminalSession {
  sendInput(input: TerminalInput): boolean;
  resize(grid: TerminalGrid): boolean;
  /** Takeover only (`openTerminal(..., { control: true })`): > 0 shows older output, < 0 newer. */
  scroll(lines: number): boolean;
  /** Takeover only: a left click at a 0-based cell (a TUI that reports the mouse gets it; a plain prompt ignores it). */
  tap(col: number, row: number): boolean;
  /** Takeover mouse mode: one phase of a left-button drag at a 0-based cell. */
  mouse(action: 'down' | 'drag' | 'up', col: number, row: number): boolean;
  close(): void;
}

export interface ChatHandlers {
  onFrame(frame: ChatFrame): void;
  /** `gone` = 4404 (the pane is gone), `noConversation` = 4409 (the agent has no readable session): do not reconnect. */
  onClose(event: { code: number; reason: string; gone: boolean; noConversation: boolean }): void;
  onError?(error: HostV3Error): void;
}

export interface HostClientV3 {
  bootstrap(): Promise<BootstrapV3>;
  /** Hand the Mac this phone's tunnel node key; it answers with its tunnel address (migrates a pairing made before the tunnel existed). */
  enrollTunnel(clientKey: string): Promise<string>;
  /** This paired phone's OS push opt-in status; no token is ever returned. */
  systemPushStatus(): Promise<SystemPushStatus>;
  /** Android Expo token registration (encrypted Host transport, ScopeManage). */
  registerSystemPush(expoToken: string): Promise<SystemPushStatus>;
  /** Refresh only an already opted-in token; never re-enables after Disable. */
  refreshSystemPushToken(expoToken: string): Promise<SystemPushStatus>;
  /** Opt out and delete this phone's push token from the Mac. */
  disableSystemPush(): Promise<SystemPushStatus>;
  /** Explicit generic test notification; queued means Expo accepted, not phone-delivered. */
  testSystemPush(): Promise<boolean>;
  tree(instance: string): Promise<TreeV3>;
  peek(instance: string, paneId: string): Promise<Peek>;
  /** The terminal's retained text beyond the live screen (`capabilities.terminalHistory`); a 409 `history_busy` is a HostV3Error with that code. */
  terminalHistory(instance: string, terminalId: string): Promise<TerminalHistory>;
  /** One-shot read of the pane's conversation; a 409 `no_conversation` is an HostV3Error with that code. */
  chat(instance: string, paneId: string): Promise<ChatResponse>;
  /** `older()` asks this stream for the previous page of its window (the next frame carries it; per socket, a reconnect starts at the newest page). */
  openChat(instance: string, paneId: string, handlers: ChatHandlers, limit?: number): { close(): void; older(): void };
  /** Herdr-gated: refusals (busy, needs_terminal, not_ready, no_agent, refused, delivery_uncertain) arrive as HostV3Error.code. */
  /** The agent's own `/` `$` rows and models for the composer (read-only on the Mac). */
  chatCatalog(instance: string, paneId: string): Promise<ChatCatalog>;
  /** Entry names of the pane's project folder matching the composer's `@` token (names only, shallow, bounded). */
  chatFiles(instance: string, paneId: string, token: string): Promise<string[]>;
  /** One sub-agent's own transcript (read-only); `unknown_subagent` when the conversation never listed it. */
  chatSubagent(instance: string, paneId: string, subagentId: string): Promise<SubagentView>;
  /** Saves one file on the Mac (needs `capabilities.attachments`); resolves with its absolute path for the `@path` mention. */
  uploadAttachment(instance: string, paneId: string, request: AttachRequest): Promise<string>;
  /** The pane-less twins of the three above, for the new-session draft: the folder (Workspace or path) and agent kind stand in for the pane. */
  draftCatalog(instance: string, folder: DraftFolderQuery, kind: string): Promise<ChatCatalog>;
  draftFiles(instance: string, folder: DraftFolderQuery, token: string): Promise<string[]>;
  uploadDraftAttachment(instance: string, request: AttachRequest): Promise<string>;
  sendChat(instance: string, paneId: string, request: ChatSendRequest): Promise<void>;
  stopChat(instance: string, paneId: string): Promise<void>;
  /** Withdraws the queued follow-up before its delivery commit (`no_queued` / `already_delivered` otherwise). */
  cancelQueued(instance: string, paneId: string): Promise<void>;
  /** Withdraws one stacked queued follow-up by id (`no_queued` when gone / `already_delivered` / `queue_failed`). */
  cancelQueuedItem(instance: string, paneId: string, requestId: string): Promise<void>;
  /** Rewrites one unclaimed queued follow-up (needs `capabilities.queueEdit`; `already_delivered` / `no_queued` / `cannot_edit` otherwise). */
  editQueuedItem(instance: string, paneId: string, requestId: string, text: string): Promise<void>;
  /** Moves one queued follow-up to list index `to` (needs `capabilities.queueEdit`; the claimed head run stays pinned: 409 `cannot_move`). */
  moveQueuedItem(instance: string, paneId: string, requestId: string, to: number): Promise<void>;
  /** Answers the blocked agent's card; a card that moved on arrives as HostV3Error.code `interaction_gone`. */
  answerChat(instance: string, paneId: string, request: ChatAnswerRequest): Promise<void>;
  /**
   * Starts a Terminal tab or an agent session on the Mac and resolves with the new pane. The Host runs
   * the whole transaction (up to ~150 s), hence the long timeout; refusals arrive as HostV3Error.code
   * (see LAUNCH_REFUSALS). Retrying the same `requestId` is safe (the Host replays, never relaunches).
   */
  launch(instance: string, request: LaunchRequest): Promise<LaunchResponse>;
  /**
   * Brings one of the Mac's saved machines up (needs `capabilities.devices`; `deviceKey` is the bootstrap entry's id,
   * `machine/<profile>`) and resolves with the instance to address it by. Refusals arrive as HostV3Error.code
   * (see DEVICE_REFUSALS); `device_needs_signin` means only the Mac's user can fix it. May take up to ~40 seconds.
   */
  connectDevice(deviceKey: string): Promise<DeviceConnectResponse>;
  /** Read-only working-tree changes of a Workspace's folder (needs `capabilities.git`). */
  gitStatus(instance: string, workspaceId: string): Promise<GitStatus>;
  /** One changed file's diff; `unknown_file` when it is no longer changed. */
  gitDiff(instance: string, workspaceId: string, path: string): Promise<GitDiff>;
  /**
   * Git writes (need `capabilities.gitWrite`, scope manage). Each answers the repository as it is afterwards
   * (and a commit's short hash); refusals arrive as HostV3Error.code (see GIT_WRITE_REFUSALS). Paths must be
   * ones the last status listed (else `unknown_file`). `head` is the short HEAD the phone reviewed: a moved HEAD
   * refuses with `git_stale` instead of committing/publishing something else.
   */
  gitStage(instance: string, workspaceId: string, paths: string[]): Promise<GitWriteResult>;
  gitUnstage(instance: string, workspaceId: string, paths: string[]): Promise<GitWriteResult>;
  gitCommit(instance: string, workspaceId: string, request: GitCommitRequest): Promise<GitWriteResult>;
  /** fetch, fast-forward-only pull, or push (the first push sets tracking). Network: may take up to ~2 minutes. */
  gitSync(instance: string, workspaceId: string, op: GitSyncOp, head?: string): Promise<GitWriteResult>;
  /** One folder of a Workspace, read-only (needs `capabilities.files`); `dir` is relative, "" = the folder itself. */
  filesList(instance: string, workspaceId: string, dir: string): Promise<FilesList>;
  /** File-name search of a Workspace, read-only (needs `capabilities.filesSearch`): the best folder-relative paths, and how many files matched. */
  filesSearch(instance: string, workspaceId: string, query: string): Promise<FilesSearch>;
  /** One file's preview (text / markdown / image data URL / binary without content). */
  fileContent(instance: string, workspaceId: string, path: string): Promise<FileContent>;
  /** The Mac's agent quota (needs `capabilities.quota`); `force` is the phone's pull-to-refresh past the Host's reuse window. */
  quota(force?: boolean): Promise<Quota>;
  /** The Mac's Automations list, read-only (needs `capabilities.automations`; 404 `automations_unavailable` while its plugin is off). */
  automations(): Promise<Automations>;
  /**
   * The Mac's Feedback inbox (needs `capabilities.feedback`): the Agent-question threads and, for `thread`, its
   * timeline. A broker that is not running is `online:false`, not an error.
   */
  feedback(thread?: string, query?: string): Promise<FeedbackSnapshot>;
  /** Answer one Ask (an expired one too — a late answer). 409 `feedback_final` once the Ask was ended or answered; 503 `feedback_offline`. */
  feedbackAnswer(askId: string, request: FeedbackAnswerRequest): Promise<void>;
  /** Close an Ask without an answer. */
  feedbackEnd(askId: string): Promise<void>;
  /** Inbox management (needs `capabilities.feedbackManage`): delete finished threads (resolves with how many went; a waiting one is kept). */
  feedbackDelete(ids: string[]): Promise<number>;
  /** Delete (or, with `dryRun`, only count) finished threads idle for `days`; resolves with the count. */
  feedbackCleanup(days: number, dryRun: boolean): Promise<number>;
  /** Keep finished threads for `days` (0 = forever). */
  feedbackRetention(days: number): Promise<void>;
  /** One automation in full — prompt, rationale, schedule fields and its newest runs (needs `capabilities.automationsManage`). */
  automationDetail(name: string): Promise<AutomationDetail>;
  /**
   * Management writes (need `capabilities.automationsManage`, scope manage). Each resolves with the Mac's freshly read list;
   * a refusal is a HostV3Error whose `code` is one of AUTOMATION_REFUSALS and, for `automation_refused`, whose message is the
   * plugin's own sentence. `createAutomation` always makes a draft — a person approves it (here or on the Mac).
   */
  createAutomation(name: string, fields: AutomationFields): Promise<Automations>;
  saveAutomation(name: string, fields: AutomationFields): Promise<Automations>;
  automationOp(name: string, op: AutomationOp): Promise<Automations>;
  startAutomationScheduler(): Promise<Automations>;
  /** Marks one run (or every finished run) as opened, which clears the Mac's unread count. */
  markAutomationSeen(target: { runId: string } | { all: true }): Promise<Automations>;
  /**
   * The Mac's Assistants (needs `capabilities.personalAgent`; 404 `personal_agent_unavailable` while the core is off). Reads are
   * the authoritative state; every write carries a `requestId` (a replay returns the first receipt) and, where the record has
   * one, the `expectedRevision` the phone showed — a moved revision is a HostV3Error `stale_revision`. Writes need
   * `capabilities.personalAgentManage` (scope manage); refusals are the core's own stable codes (PERSONAL_AGENT_REFUSALS).
   */
  personalAgentOverview(): Promise<AssistantOverview>;
  assistantDetail(id: string): Promise<AssistantDetail>;
  /**
   * The Coordinator's previous conversation, read-only (needs `capabilities.personalAgentCoordinatorChat`): the Mac's own catalog row
   * for it, so a stopped Assistant's page can show what it said last. null = it has none yet (409 `no_conversation`).
   */
  /** `older` walks the window that many pages up the conversation (the Host opens a fresh reader per request; capped there). */
  coordinatorChat(id: string, older?: number, limit?: number): Promise<CoordinatorChat | null>;
  /** What needs a person, ranked by the core; one Assistant or all of them. */
  assistantInbox(assistantId?: string): Promise<AssistantInboxItem[]>;
  /** Pending approvals of one Assistant, or of all of them. */
  assistantApprovals(assistantId?: string): Promise<AssistantApproval[]>;
  createAssistant(requestId: string, name: string, description?: string): Promise<Assistant>;
  renameAssistant(requestId: string, id: string, name: string, expectedRevision: number): Promise<Assistant>;
  setAssistantPaused(requestId: string, id: string, paused: boolean, expectedRevision: number): Promise<Assistant>;
  /** Persists a Goal draft only (nothing runs until it is approved, here or on the Mac). */
  draftGoal(requestId: string, input: { assistantId: string; title: string; objective?: string; commitments?: AssistantCommitmentInput[] }): Promise<AssistantGoal>;
  goalAction(requestId: string, id: string, action: AssistantGoalAction, expectedRevision: number): Promise<AssistantGoal>;
  taskAction(requestId: string, id: string, action: AssistantTaskAction, expectedRevision: number): Promise<AssistantTaskReceipt['task']>;
  /** Bring the Assistant's Coordinator (its conversation) up on `agent` (empty = the plugin's default); one start per requestId. */
  startCoordinator(requestId: string, id: string, agent: string): Promise<AssistantCoordinator>;
  /**
   * Stop it: the core marks it stopped and closes its own Herdr pane; the conversation stays and the next start resumes it.
   * An older Host without the route answers 404 (`not_found`).
   */
  stopCoordinator(requestId: string, id: string): Promise<AssistantCoordinator>;
  /**
   * Groups (needs `capabilities.personalAgentGroups`): real multi-author conversations the Mac's core owns. `groupFeed` reads the
   * newest page, or only what came after message `since`; `postGroupMessage` is the person's own message — only the
   * Assistants in `mentions` (ids whose `@Name` is in the text) are woken. There is no call that speaks for an Assistant.
   */
  groups(): Promise<Group[]>;
  groupFeed(id: string, since?: number): Promise<GroupFeed>;
  createGroup(requestId: string, title: string, members: string[]): Promise<Group>;
  postGroupMessage(groupId: string, request: GroupMessageRequest): Promise<GroupPostResult>;
  renameGroup(requestId: string, id: string, title: string, expectedRevision: number): Promise<Group>;
  /**
   * Archive / restore / delete (needs `capabilities.personalAgentGroupArchive`). Archiving hides a Group and keeps its log; the
   * core refuses (bad_state, with its own sentence) while an Assistant's terminal for the Group is still open. Deleting is
   * for an archived Group only and is permanent. Each carries the revision last read.
   */
  archivedGroups(): Promise<Group[]>;
  archiveGroup(requestId: string, id: string, expectedRevision: number): Promise<Group>;
  restoreGroup(requestId: string, id: string, expectedRevision: number): Promise<Group>;
  deleteGroup(requestId: string, id: string, expectedRevision: number): Promise<void>;
  /**
   * Persona (needs `capabilities.personalAgentPersona`): how one Assistant works. Saving instructions / the Agent profile only
   * reaches Agents started afterwards; `verifyMcp` starts a headless Agent on the Mac to read which granted servers it connects
   * to (no model request) and can take up to a minute.
   */
  assistantInstructions(id: string): Promise<Instructions>;
  saveInstructions(requestId: string, id: string, body: string, expectedRevision: number): Promise<Instructions>;
  restoreInstructions(requestId: string, id: string, revision: number, expectedRevision: number): Promise<Instructions>;
  assistantRuntime(id: string): Promise<Runtime>;
  saveRuntime(requestId: string, id: string, input: { agent: string; model: string; effort: string; idleSleepMin?: number }, expectedRevision: number): Promise<Runtime>;
  assistantMcp(id: string): Promise<McpView>;
  /** Oldest-first durable Solco progress messages. Start after the last ACK to replay after reconnect. */
  assistantActivity(id: string, after?: number, limit?: number): Promise<AssistantActivityPage>;
  /** ACK only after handling the Activity items. A disconnect may retry the same requestId. */
  ackAssistantActivity(requestId: string, id: string, seq: number): Promise<number>;
  /** Separate durable notification cursor, scoped to this authenticated device.
   * This NEVER updates the Activity History screen's manually seen cursor.
   */
  assistantNotificationActivity(id: string, limit?: number): Promise<AssistantActivityPage>;
  ackAssistantNotification(requestId: string, id: string, seq: number): Promise<number>;
  /** Delivery status for an opt-in narrative report in the original OMP Chat. */
  assistantCoordinatorReport(id: string): Promise<CoordinatorReport>;
  /** Explicit owner decision for one uncertain delivery; retry can duplicate. */
  resolveAssistantCoordinatorReport(requestId: string, id: string, throughSeq: number, action: 'skip' | 'retry'): Promise<CoordinatorReport>;
  /** Both memory notes (the person's USER.md and the Assistant's ASSISTANT.md), each with the rev a write must name. */
  assistantNotes(id: string): Promise<Notes>;
  /** Replace one note whole. A file that moved on since `expectedRev` is refused (`stale_revision`), never merged. */
  saveNotes(id: string, file: NotesFileName, text: string, expectedRev: string): Promise<Notes>;
  assistantProactivity(id: string): Promise<Proactivity>;
  saveProactivity(requestId: string, id: string, input: ProactivityInput, expectedRevision: number): Promise<Proactivity>;
  grantMcp(requestId: string, id: string, serverId: string, granted: boolean): Promise<McpView>;
  verifyMcp(id: string): Promise<McpView>;
  /** Answers one approval card with the exact `actionHash` it showed. */
  decideApproval(requestId: string, id: string, actionHash: string, approve: boolean): Promise<AssistantApproval>;
  /**
   * Continues one cataloged session on the Mac (needs `capabilities.sessionContinue`) with the same Agent and
   * resolves with the pane it runs in. The Host runs the whole transaction (up to ~150 s); refusals arrive as
   * HostV3Error.code (see SESSION_CONTINUE_REFUSALS). A session an Agent already runs is just located.
   */
  continueSession(instance: string, sessionId: string): Promise<ContinueResponse>;
  /** Transcribes one recorded clip with the Mac's own Voice source (needs `capabilities.voice`); refusals as HostV3Error.code (see VOICE_REFUSALS). */
  transcribe(request: VoiceRequest): Promise<VoiceResponse>;
  /** The Mac's session catalog (needs `capabilities.sessions`): metadata only, searched on the Mac, running sessions first. */
  sessions(search?: string): Promise<Sessions>;
  /** Moves one cataloged session into the Mac's Sessions Trash (needs `capabilities.sessionTrash`); refusals as HostV3Error.code (see SESSION_TRASH_REFUSALS). Resolves with the Trash entry — the key to put it back. */
  trashSession(sessionId: string): Promise<TrashAnswer>;
  /** The Trash's entries, newest deletion first (needs `capabilities.sessionTrash`). */
  sessionTrash(): Promise<TrashList>;
  /** Puts one Trash entry back where it came from; only reversible steps exist here — permanent deletion is on the Mac. */
  restoreSession(entryId: string): Promise<TrashAnswer>;
  /** STUN/TURN entries the Mac wants both ends to use (needs `capabilities.p2p`; 404 `p2p_unavailable` otherwise). */
  p2pIce(): Promise<P2PIceServer[]>;
  /** Trade a gathered WebRTC offer for the Mac's answer; the DataChannel then carries the same v3 API. */
  p2pSession(sdp: string): Promise<P2PSessionAnswer>;
  /** Readiness of the Mac's Remote Desktop (needs `capabilities.remoteDesktop`; 404 `remote_disabled` when the Mac has it off). */
  remoteDesktopInfo(): Promise<RdInfo>;
  /** Trade a complete WebRTC offer for the Mac's answer; blocks while the person at the Mac approves. Refusals as HostV3Error.code (see RD_REFUSALS). */
  remoteDesktopSession(offer: RdOffer): Promise<RdAnswer>;
  openEvents(instance: string, handlers: EventsHandlers): { close(): void };
  /** `options.control` asks for the explicit takeover (`capabilities.terminalControl`): the PTY takes `grid` and the Mac's attach is replaced. */
  openTerminal(instance: string, terminalId: string, grid: TerminalGrid, handlers: TerminalHandlers, options?: { control?: boolean }): TerminalSession;
}

/** Names the folder of a pane-less draft: an existing Workspace, or an absolute path on the Mac. */
export type DraftFolderQuery = { workspaceId: string } | { path: string };

function draftQuery(folder: DraftFolderQuery): string {
  return 'workspaceId' in folder ? `workspaceId=${encodeURIComponent(folder.workspaceId)}` : `path=${encodeURIComponent(folder.path)}`;
}

const PING_INTERVAL_MS = 25_000;
/** A little over the Host's own 150 s launch budget, so its verdict (not ours) is what the user reads. */
const LAUNCH_TIMEOUT_MS = 160_000;
/** An automation write is a few CLI calls on the Mac (a scheduler start adds a short settle). */
const AUTOMATION_TIMEOUT_MS = 45_000;
/** A headless Agent start on the Mac; the Host bounds it at 45 s. */
const MCP_VERIFY_TIMEOUT_MS = 60_000;
/** One provider's whole read is bounded by the Host at 25 s; a forced refresh waits for the slowest of them. */
const QUOTA_TIMEOUT_MS = 30_000;
/** The Mac gathers ICE (≤ 8 s) before it answers a P2P offer. */
const P2P_SESSION_TIMEOUT_MS = 20_000;
/** The Mac waits up to 45 s for its user to approve a Remote Desktop request, then gathers ICE. */
const REMOTE_DESKTOP_TIMEOUT_MS = 65_000;
/** A phone photo over a mobile link: generous, and the same ceiling the native transport applies. */
const ATTACHMENT_TIMEOUT_MS = 120_000;

/** The P2P route a client may ride on: the Mac's tunnel over an open DataChannel (lib/p2p-session). */
export interface P2PRoute {
  request(init: P2PRequestInit): Promise<PinnedResponse>;
  openSocket(url: string, handlers: PinnedSocketHandlers): PinnedSocket;
}

/** Placeholder origin for the P2P route: the Mac's tunnel takes a path, the origin is never dialled. */
const P2P_ORIGIN = 'https://host.p2p';

export function createHostClientV3(transport: PinnedTransport | null, connection: HostConnectionV3, p2p?: P2PRoute): HostClientV3 {
  // One client, two routes: `relay` present → route=relay, everything through the registered relay
  // endpoint with the JS layer's own fetch/WebSocket (the relay URL is CA-signed, nothing to pin;
  // the native pinned transport is not touched). Absent → route=lan, the pinned transport as ever.
  // A live P2P channel outranks the relay (direct > P2P > relay) and carries the same API.
  const relayBase = p2p ? null : relayBaseUrl(connection);
  const base = p2p ? P2P_ORIGIN : (relayBase ?? hostConnectionBaseUrl(connection));
  const wsBase = base.replace(/^https:/, 'wss:');
  const authorization = { authorization: `Bearer ${connection.token}` };
  const protocols = [V3_BEARER_SUBPROTOCOL, connection.token];

  const routeRequest: (init: RelayRequestInit) => Promise<PinnedResponse> = p2p
    ? (init) => p2p.request(init)
    : relayBase
      ? relayRequest
      : (init) => transport!.request({ ...init, fingerprint: connection.fingerprint });

  const openSocket =
    p2p || relayBase
      ? (url: string, handlers: PinnedSocketHandlers): PinnedSocket => {
          // route=relay / route=p2p carry neither headers nor subprotocols on a socket: the token rides the query.
          const tokenized = `${url}${relayTokenQuery(url, connection.token)}`;
          return p2p ? p2p.openSocket(tokenized, handlers) : relayOpenSocket(tokenized, handlers);
        }
      : (url: string, handlers: PinnedSocketHandlers): PinnedSocket =>
          transport!.openSocket({ url, fingerprint: connection.fingerprint, protocols }, handlers);

  async function get<T>(path: string, schema: z.ZodType<T>, what: string, timeoutMs?: number): Promise<T> {
  try {
    const response = await routeRequest({
      url: `${base}${V3_API_PREFIX}${path}`,
      headers: authorization,
      timeoutMs,
    });
    if (response.status !== 200) throw failureFromResponse(response.status, response.body, what);
    return parseBody(schema, response.body, what);
  } catch (error) {
    throw describeFailure(error);
  }
}

  async function post(path: string, body: string | null, what: string): Promise<void> {
    try {
      const response = await routeRequest({
        url: `${base}${V3_API_PREFIX}${path}`,
        method: 'POST',
        headers: body === null ? authorization : { ...authorization, 'content-type': 'application/json' },
        body: body ?? undefined,
      });
      if (response.status !== 200) throw failureFromResponse(response.status, response.body, what);
      parseBody(chatAckSchema, response.body, what);
    } catch (error) {
      throw describeFailure(error);
    }
  }

  async function slowPostJson<T>(path: string, body: string, schema: z.ZodType<T>, what: string, timeoutMs = LAUNCH_TIMEOUT_MS): Promise<T> {
    try {
      const response = await routeRequest({
        url: `${base}${V3_API_PREFIX}${path}`,
        method: 'POST',
        headers: { ...authorization, 'content-type': 'application/json' },
        body,
        timeoutMs,
      });
      if (response.status !== 200) throw failureFromResponse(response.status, response.body, what);
      return parseBody(schema, response.body, what);
    } catch (error) {
      throw describeFailure(error);
    }
  }

  const q = encodeURIComponent;

  return {
    bootstrap: () => get('/bootstrap', bootstrapV3Schema, 'bootstrap'),
    enrollTunnel: async (clientKey) =>
      (await slowPostJson('/connect/enroll', JSON.stringify({ clientKey }), enrollResponseSchema, 'enroll')).tailcat,
    systemPushStatus: () => get('/notifications/push', systemPushStatusSchema, 'system push'),
    registerSystemPush: (token) =>
      slowPostJson('/notifications/push/register', JSON.stringify({ token }), systemPushStatusSchema, 'system push'),
    refreshSystemPushToken: (token) =>
      slowPostJson('/notifications/push/refresh', JSON.stringify({ token }), systemPushStatusSchema, 'system push'),
    disableSystemPush: () =>
      slowPostJson('/notifications/push/disable', '{}', systemPushStatusSchema, 'system push'),
    testSystemPush: async () =>
      (await slowPostJson('/notifications/push/test', '{}',
        z.object({ schema: z.literal(1), queued: z.boolean() }), 'system push')).queued,
    tree: (instance) => get(`/tree?instance=${q(instance)}`, treeV3Schema, 'tree'),
    peek: (instance, paneId) => get(`/panes/${q(paneId)}/peek?instance=${q(instance)}`, peekSchema, 'peek'),
    terminalHistory: (instance, terminalId) => get(`/terminals/${q(terminalId)}/history?instance=${q(instance)}`, terminalHistorySchema, 'terminal history'),

    chat: (instance, paneId) => get(`/panes/${q(paneId)}/chat?instance=${q(instance)}`, chatResponseSchema, 'chat'),

    openChat(instance, paneId, handlers, limit) {
      let last: ChatFrame | null = null;
      let awaitingSnapshot = false;
      const snapshot = () => {
        if (!awaitingSnapshot) {
          awaitingSnapshot = true;
          socket.sendText('{"t":"snapshot"}');
        }
      };
      const limitParam = limit && limit > 0 ? `&limit=${limit}` : '';
      const socket = openSocket(`${wsBase}${V3_API_PREFIX}/panes/${q(paneId)}/chat/stream?instance=${q(instance)}${limitParam}`, {
        onText(text) {
          try {
            const parsed = chatWireFrameSchema.safeParse(JSON.parse(text));
            if (!parsed.success) { snapshot(); return; }
            if (parsed.data.t === 'chat') {
              last = parsed.data;
              awaitingSnapshot = false;
            } else {
              if (awaitingSnapshot) return;
              last = applyHostChatDelta(last, parsed.data);
              if (!last) { snapshot(); return; }
            }
            handlers.onFrame(last);
          } catch {
            // A corrupt/lost wire frame cannot be replayed as a suffix.
            snapshot();
          }
        },
        onClose: (event) =>
          handlers.onClose({
            ...event,
            gone: event.code === V3_CLOSE_TERMINAL_GONE,
            noConversation: event.code === V3_CLOSE_NO_CONVERSATION,
          }),
        onError: (error) => handlers.onError?.(describeFailure(error)),
      });
      return { close: () => socket.close(1000, 'client closed'), older: () => socket.sendText('{"t":"older"}') };
    },

    chatFiles: async (instance, paneId, token) =>
      (await get(`/panes/${q(paneId)}/chat/files?instance=${q(instance)}&token=${q(token)}`, chatFilesSchema, 'chat files')).files,
    chatCatalog: (instance, paneId) => get(`/panes/${q(paneId)}/chat/catalog?instance=${q(instance)}`, chatCatalogSchema, 'chat catalog'),
    chatSubagent: (instance, paneId, subagentId) =>
      get(`/panes/${q(paneId)}/chat/subagents/${q(subagentId)}?instance=${q(instance)}`, subagentViewSchema, 'sub-agent'),
    uploadAttachment: async (instance, paneId, request) => {
      const what = 'attachment';
      try {
        const response = await routeRequest({
          url: `${base}${V3_API_PREFIX}/panes/${q(paneId)}/chat/attachments?instance=${q(instance)}`,
          method: 'POST',
          headers: { ...authorization, 'content-type': 'application/json' },
          body: JSON.stringify(attachRequestSchema.parse(request)),
          timeoutMs: ATTACHMENT_TIMEOUT_MS,
        });
        if (response.status !== 200) throw failureFromResponse(response.status, response.body, what);
        return parseBody(attachReplySchema, response.body, what).path;
      } catch (error) {
        throw describeFailure(error);
      }
    },
    draftCatalog: (instance, folder, kind) =>
      get(`/launch/catalog?instance=${q(instance)}&kind=${q(kind)}&${draftQuery(folder)}`, chatCatalogSchema, 'chat catalog'),
    draftFiles: async (instance, folder, token) =>
      (await get(`/launch/files?instance=${q(instance)}&token=${q(token)}&${draftQuery(folder)}`, chatFilesSchema, 'chat files')).files,
    uploadDraftAttachment: async (instance, request) => {
      const what = 'attachment';
      try {
        const response = await routeRequest({
          url: `${base}${V3_API_PREFIX}/launch/attachments?instance=${q(instance)}`,
          method: 'POST',
          headers: { ...authorization, 'content-type': 'application/json' },
          body: JSON.stringify(attachRequestSchema.parse(request)),
          timeoutMs: ATTACHMENT_TIMEOUT_MS,
        });
        if (response.status !== 200) throw failureFromResponse(response.status, response.body, what);
        return parseBody(attachReplySchema, response.body, what).path;
      } catch (error) {
        throw describeFailure(error);
      }
    },
    sendChat: (instance, paneId, request) =>
      post(`/panes/${q(paneId)}/chat/send?instance=${q(instance)}`, JSON.stringify(request), 'send'),
    stopChat: (instance, paneId) => post(`/panes/${q(paneId)}/chat/stop?instance=${q(instance)}`, null, 'stop'),
    cancelQueued: (instance, paneId) => post(`/panes/${q(paneId)}/chat/queue/cancel?instance=${q(instance)}`, '{}', 'cancel queue'),
    cancelQueuedItem: (instance, paneId, requestId) =>
      post(`/panes/${q(paneId)}/chat/queue/item/${encodeURIComponent(requestId)}/cancel?instance=${q(instance)}`, '{}', 'cancel queue item'),
    editQueuedItem: (instance, paneId, requestId, text) =>
      post(`/panes/${q(paneId)}/chat/queue/item/${encodeURIComponent(requestId)}/edit?instance=${q(instance)}`, JSON.stringify({ text }), 'edit queue item'),
    moveQueuedItem: (instance, paneId, requestId, to) =>
      post(`/panes/${q(paneId)}/chat/queue/item/${encodeURIComponent(requestId)}/move?instance=${q(instance)}`, JSON.stringify({ to }), 'move queue item'),
    answerChat: (instance, paneId, request) =>
      post(`/panes/${q(paneId)}/chat/answer?instance=${q(instance)}`, JSON.stringify(request), 'answer'),

    launch: async (instance, request) =>
      slowPostJson(`/launch?instance=${q(instance)}`, JSON.stringify(launchRequestSchema.parse(request)), launchResponseSchema, 'launch'),
    transcribe: async (request) => slowPostJson('/voice/transcribe', JSON.stringify(voiceRequestSchema.parse(request)), voiceResponseSchema, 'voice'),
    continueSession: async (instance, sessionId) =>
      slowPostJson(`/sessions/${q(sessionId)}/continue?instance=${q(instance)}`, '', continueResponseSchema, 'continue'),

    trashSession: (sessionId) => slowPostJson(`/sessions/${q(sessionId)}/trash`, '', trashAnswerSchema, 'trash session'),
    restoreSession: (entryId) => slowPostJson(`/sessions/trash/${q(entryId)}/restore`, '', trashAnswerSchema, 'put session back'),
    sessionTrash: () => get('/sessions/trash', trashListSchema, 'session trash'),


    connectDevice: (deviceKey) =>
      slowPostJson(`/devices/${q(deviceKey.replace(/^machine\//, ''))}/connect`, '', deviceConnectResponseSchema, 'device connect'),

    gitStatus: (instance, workspaceId) => get(`/workspaces/${q(workspaceId)}/git?instance=${q(instance)}`, gitStatusSchema, 'git status'),

    gitStage: (instance, workspaceId, paths) =>
      slowPostJson(`/workspaces/${q(workspaceId)}/git/stage?instance=${q(instance)}`, JSON.stringify({ paths }), gitWriteResultSchema, 'git stage'),
    gitUnstage: (instance, workspaceId, paths) =>
      slowPostJson(`/workspaces/${q(workspaceId)}/git/unstage?instance=${q(instance)}`, JSON.stringify({ paths }), gitWriteResultSchema, 'git unstage'),
    gitCommit: async (instance, workspaceId, request) =>
      slowPostJson(`/workspaces/${q(workspaceId)}/git/commit?instance=${q(instance)}`, JSON.stringify(gitCommitRequestSchema.parse(request)), gitWriteResultSchema, 'git commit'),
    gitSync: (instance, workspaceId, op, head) =>
      slowPostJson(`/workspaces/${q(workspaceId)}/git/${op}?instance=${q(instance)}`, JSON.stringify(head ? { head } : {}), gitWriteResultSchema, `git ${op}`),

    gitDiff: (instance, workspaceId, path) =>
      get(`/workspaces/${q(workspaceId)}/git/diff?instance=${q(instance)}&path=${q(path)}`, gitDiffSchema, 'git diff'),

    filesList: (instance, workspaceId, dir) =>
      get(`/workspaces/${q(workspaceId)}/files?instance=${q(instance)}&dir=${q(dir)}`, filesListSchema, 'files'),
    filesSearch: (instance, workspaceId, query) =>
      get(`/workspaces/${q(workspaceId)}/files/search?instance=${q(instance)}&q=${q(query)}`, filesSearchSchema, 'file search'),

    fileContent: (instance, workspaceId, path) =>
      get(`/workspaces/${q(workspaceId)}/files/content?instance=${q(instance)}&path=${q(path)}`, fileContentSchema, 'file'),

    p2pIce: async () => (await get('/p2p/ice', p2pIceSchema, 'p2p ice')).iceServers,
    p2pSession: async (sdp) => {
      const what = 'p2p session';
      try {
        const response = await routeRequest({
          url: `${base}${V3_API_PREFIX}/p2p/session`,
          method: 'POST',
          headers: { ...authorization, 'content-type': 'application/json' },
          body: JSON.stringify({ sdp }),
          timeoutMs: P2P_SESSION_TIMEOUT_MS,
        });
        if (response.status !== 200) throw failureFromResponse(response.status, response.body, what);
        return parseBody(p2pSessionSchema, response.body, what);
      } catch (error) {
        throw describeFailure(error);
      }
    },
    remoteDesktopInfo: () => get('/remote-desktop', rdInfoSchema, 'remote desktop'),
    remoteDesktopSession: (offer) => slowPostJson('/remote-desktop/session', JSON.stringify(rdOfferSchema.parse(offer)), rdAnswerSchema, 'remote desktop', REMOTE_DESKTOP_TIMEOUT_MS),
    quota: (force) => get(`/quota${force ? '?refresh=1' : ''}`, quotaSchema, 'quota', QUOTA_TIMEOUT_MS),
    automations: () => get('/automations', automationsSchema, 'automations'),
    feedback: (thread, query) => {
      const params = [thread ? `thread=${q(thread)}` : '', query ? `q=${q(query)}` : ''].filter(Boolean).join('&');
      return get(`/feedback${params ? `?${params}` : ''}`, feedbackSnapshotSchema, 'feedback');
    },
    feedbackAnswer: (askId, request) => post(`/feedback/asks/${q(askId)}/answer`, JSON.stringify(feedbackAnswerRequestSchema.parse(request)), 'feedback'),
    feedbackEnd: (askId) => post(`/feedback/asks/${q(askId)}/end`, null, 'feedback'),
    feedbackDelete: async (ids) =>
      (await slowPostJson('/feedback/threads/delete', JSON.stringify(feedbackDeleteRequestSchema.parse({ ids })), feedbackDeleteResultSchema, 'feedback')).deleted,
    feedbackCleanup: async (days, dryRun) => {
      const done = await slowPostJson(
        '/feedback/threads/cleanup',
        JSON.stringify(feedbackCleanupRequestSchema.parse({ olderThanDays: days, dryRun })),
        feedbackCleanupResultSchema,
        'feedback',
      );
      return dryRun ? done.matched : done.deleted;
    },
    feedbackRetention: (days) => post('/feedback/retention', JSON.stringify(feedbackRetentionRequestSchema.parse({ days })), 'feedback'),
    automationDetail: (name) => get(`/automations/${q(name)}`, automationDetailSchema, 'automation'),
    createAutomation: (name, fields) =>
      slowPostJson('/automations', JSON.stringify(automationWriteSchema.parse({ ...fields, name })), automationsSchema, 'automation', AUTOMATION_TIMEOUT_MS),
    saveAutomation: (name, fields) =>
      slowPostJson(`/automations/${q(name)}/save`, JSON.stringify(automationWriteSchema.parse({ ...fields, name })), automationsSchema, 'automation', AUTOMATION_TIMEOUT_MS),
    automationOp: (name, op) => slowPostJson(`/automations/${q(name)}/${op}`, '', automationsSchema, 'automation', AUTOMATION_TIMEOUT_MS),
    startAutomationScheduler: () => slowPostJson('/automations/scheduler/start', '', automationsSchema, 'automation', AUTOMATION_TIMEOUT_MS),
    markAutomationSeen: (target) => slowPostJson('/automations/seen', JSON.stringify(target), automationsSchema, 'automation', AUTOMATION_TIMEOUT_MS),
    personalAgentOverview: () => get('/personal-agent/overview', assistantOverviewSchema, 'assistants'),
    assistantDetail: (id) => get(`/personal-agent/assistants/${q(id)}`, assistantDetailSchema, 'assistants'),
    coordinatorChat: (id, older = 0, limit) => {
      const parts: string[] = [];
      if (older > 0) parts.push(`older=${older}`);
      if (limit && limit > 0) parts.push(`limit=${limit}`);
      const qs = parts.length > 0 ? `?${parts.join('&')}` : '';
      return get(`/personal-agent/assistants/${q(id)}/coordinator/chat${qs}`, coordinatorChatSchema, 'assistants').catch((failure: unknown) => {
        if (failure instanceof HostV3Error && failure.code === 'no_conversation') return null;
        throw failure;
      });
    },
    assistantInbox: async (assistantId) =>
      (await get(`/personal-agent/inbox${assistantId ? `?assistant=${q(assistantId)}` : ''}`, assistantInboxSchema, 'assistants')).items,
    assistantApprovals: async (assistantId) =>
      (await get(`/personal-agent/approvals${assistantId ? `?assistant=${q(assistantId)}` : ''}`, assistantApprovalsSchema, 'assistants')).approvals,
    createAssistant: async (requestId, name, description) =>
      (await slowPostJson('/personal-agent/assistants', JSON.stringify({ requestId, name, description: description ?? '' }), assistantReceiptSchema, 'assistants', AUTOMATION_TIMEOUT_MS)).assistant,
    renameAssistant: async (requestId, id, name, expectedRevision) =>
      (await slowPostJson(`/personal-agent/assistants/${q(id)}/rename`, JSON.stringify({ requestId, name, expectedRevision }), assistantReceiptSchema, 'assistants', AUTOMATION_TIMEOUT_MS)).assistant,
    setAssistantPaused: async (requestId, id, paused, expectedRevision) =>
      (await slowPostJson(`/personal-agent/assistants/${q(id)}/${paused ? 'pause' : 'resume'}`, JSON.stringify({ requestId, expectedRevision }), assistantReceiptSchema, 'assistants', AUTOMATION_TIMEOUT_MS)).assistant,
    draftGoal: async (requestId, input) =>
      (
        await slowPostJson(
          '/personal-agent/goals/draft',
          JSON.stringify({ requestId, ...input, commitments: (input.commitments ?? []).map((c) => assistantCommitmentInputSchema.parse(c)) }),
          assistantGoalReceiptSchema,
          'assistants',
          AUTOMATION_TIMEOUT_MS,
        )
      ).goal,
    goalAction: async (requestId, id, action, expectedRevision) =>
      (await slowPostJson(`/personal-agent/goals/${q(id)}/${action}`, JSON.stringify({ requestId, expectedRevision }), assistantGoalReceiptSchema, 'assistants', AUTOMATION_TIMEOUT_MS)).goal,
    taskAction: async (requestId, id, action, expectedRevision) =>
      (await slowPostJson(`/personal-agent/tasks/${q(id)}/${action}`, JSON.stringify({ requestId, expectedRevision }), assistantTaskReceiptSchema, 'assistants', AUTOMATION_TIMEOUT_MS)).task,
    startCoordinator: async (requestId, id, agent) =>
      (await slowPostJson(`/personal-agent/assistants/${q(id)}/coordinator/start`, JSON.stringify({ requestId, agent }), assistantCoordinatorReceiptSchema, 'assistants', AUTOMATION_TIMEOUT_MS)).coordinator,
    stopCoordinator: async (requestId, id) =>
      (await slowPostJson(`/personal-agent/assistants/${q(id)}/coordinator/stop`, JSON.stringify({ requestId }), assistantCoordinatorReceiptSchema, 'assistants', AUTOMATION_TIMEOUT_MS)).coordinator,
    groups: async () => (await get('/personal-agent/groups', groupsListSchema, 'assistants')).groups,
    groupFeed: async (id, since) =>
      (await get(`/personal-agent/groups/${q(id)}${since && since > 0 ? `?since=${since}` : ''}`, groupFeedResponseSchema, 'assistants')).feed,
    createGroup: async (requestId, title, members) =>
      (await slowPostJson('/personal-agent/groups', JSON.stringify({ requestId, title, members }), groupReceiptSchema, 'assistants', AUTOMATION_TIMEOUT_MS)).group,
    postGroupMessage: async (groupId, request) =>
      (
        await slowPostJson(
          `/personal-agent/groups/${q(groupId)}/messages`,
          JSON.stringify(groupMessageRequestSchema.parse(request)),
          groupPostResponseSchema,
          'assistants',
          AUTOMATION_TIMEOUT_MS,
        )
      ).result,
    renameGroup: async (requestId, id, title, expectedRevision) =>
      (await slowPostJson(`/personal-agent/groups/${q(id)}/rename`, JSON.stringify({ requestId, title, expectedRevision }), groupReceiptSchema, 'assistants', AUTOMATION_TIMEOUT_MS)).group,
    archivedGroups: async () => (await get('/personal-agent/groups/archived', groupsListSchema, 'assistants')).groups,
    archiveGroup: async (requestId, id, expectedRevision) =>
      (await slowPostJson(`/personal-agent/groups/${q(id)}/archive`, JSON.stringify({ requestId, expectedRevision }), groupReceiptSchema, 'assistants', AUTOMATION_TIMEOUT_MS)).group,
    restoreGroup: async (requestId, id, expectedRevision) =>
      (await slowPostJson(`/personal-agent/groups/${q(id)}/restore`, JSON.stringify({ requestId, expectedRevision }), groupReceiptSchema, 'assistants', AUTOMATION_TIMEOUT_MS)).group,
    deleteGroup: async (requestId, id, expectedRevision) => {
      await slowPostJson(`/personal-agent/groups/${q(id)}/delete`, JSON.stringify({ requestId, expectedRevision }), groupDeletedSchema, 'assistants', AUTOMATION_TIMEOUT_MS);
    },
    assistantInstructions: async (id) => (await get(`/personal-agent/assistants/${q(id)}/instructions`, instructionsResponseSchema, 'assistants')).instructions,
    saveInstructions: async (requestId, id, body, expectedRevision) =>
      (await slowPostJson(`/personal-agent/assistants/${q(id)}/instructions`, JSON.stringify({ requestId, body, expectedRevision }), instructionsResponseSchema, 'assistants', AUTOMATION_TIMEOUT_MS)).instructions,
    restoreInstructions: async (requestId, id, revision, expectedRevision) =>
      (await slowPostJson(`/personal-agent/assistants/${q(id)}/instructions/restore`, JSON.stringify({ requestId, revision, expectedRevision }), instructionsResponseSchema, 'assistants', AUTOMATION_TIMEOUT_MS)).instructions,
    assistantRuntime: async (id) => (await get(`/personal-agent/assistants/${q(id)}/runtime`, runtimeResponseSchema, 'assistants')).runtime,
    saveRuntime: async (requestId, id, input, expectedRevision) =>
      (await slowPostJson(`/personal-agent/assistants/${q(id)}/runtime`, JSON.stringify({ requestId, ...input, expectedRevision }), runtimeResponseSchema, 'assistants', AUTOMATION_TIMEOUT_MS)).runtime,
    assistantActivity: (id, after = 0, limit = 50) =>
      get(`/personal-agent/assistants/${q(id)}/activity?after=${after}&limit=${limit}`, assistantActivityPageSchema, 'assistants'),
    ackAssistantActivity: async (requestId, id, seq) =>
      (await slowPostJson(
        `/personal-agent/assistants/${q(id)}/activity/ack`,
        JSON.stringify({ requestId, seq }),
        assistantActivityAckSchema,
        'assistants',
        AUTOMATION_TIMEOUT_MS,
      )).ackSeq,
    assistantNotificationActivity: (id, limit = 100) =>
      get(`/personal-agent/assistants/${q(id)}/activity/notifications?limit=${limit}`, assistantActivityPageSchema, 'assistants'),
    ackAssistantNotification: async (requestId, id, seq) =>
      (await slowPostJson(
        `/personal-agent/assistants/${q(id)}/activity/notifications/ack`,
        JSON.stringify({ requestId, seq }),
        assistantActivityAckSchema,
        'assistants',
        AUTOMATION_TIMEOUT_MS,
      )).ackSeq,
    assistantCoordinatorReport: async (id) =>
      (await get(`/personal-agent/assistants/${q(id)}/report`, coordinatorReportResponseSchema, 'assistants')).report,
    resolveAssistantCoordinatorReport: async (requestId, id, throughSeq, action) =>
      (await slowPostJson(
        `/personal-agent/assistants/${q(id)}/report/resolve`,
        JSON.stringify({ requestId, throughSeq, action, confirmed: true }),
        coordinatorReportResponseSchema,
        'assistants',
        AUTOMATION_TIMEOUT_MS,
      )).report,
    assistantNotes: async (id) => (await get(`/personal-agent/assistants/${q(id)}/memory`, notesResponseSchema, 'assistants')).notes,
    saveNotes: async (id, file, text, expectedRev) =>
      (await slowPostJson(`/personal-agent/assistants/${q(id)}/memory/write`, JSON.stringify({ file, text, expectedRev }), notesResponseSchema, 'assistants', AUTOMATION_TIMEOUT_MS)).notes,
    assistantProactivity: async (id) => (await get(`/personal-agent/assistants/${q(id)}/proactivity`, proactivityResponseSchema, 'assistants')).proactivity,
    saveProactivity: async (requestId, id, input, expectedRevision) =>
      (await slowPostJson(`/personal-agent/assistants/${q(id)}/proactivity`, JSON.stringify({ requestId, ...input, expectedRevision }), proactivityResponseSchema, 'assistants', AUTOMATION_TIMEOUT_MS)).proactivity,
    assistantMcp: async (id) => (await get(`/personal-agent/assistants/${q(id)}/mcp`, mcpResponseSchema, 'assistants')).mcp,
    grantMcp: async (requestId, id, serverId, granted) =>
      (await slowPostJson(`/personal-agent/assistants/${q(id)}/mcp/grant`, JSON.stringify({ requestId, serverId, granted }), mcpResponseSchema, 'assistants', AUTOMATION_TIMEOUT_MS)).mcp,
    verifyMcp: async (id) => (await slowPostJson(`/personal-agent/assistants/${q(id)}/mcp/verify`, '{}', mcpResponseSchema, 'assistants', MCP_VERIFY_TIMEOUT_MS)).mcp,
    decideApproval: async (requestId, id, actionHash, approve) =>
      (
        await slowPostJson(
          `/personal-agent/approvals/${q(id)}/decision`,
          JSON.stringify(assistantDecisionRequestSchema.parse({ requestId, actionHash, approve })),
          assistantApprovalReceiptSchema,
          'assistants',
          AUTOMATION_TIMEOUT_MS,
        )
      ).approval,
    sessions: (search) => get(`/sessions${search?.trim() ? `?q=${q(search.trim())}` : ''}`, sessionsSchema, 'sessions'),
    openEvents(instance, handlers) {
      const socket = openSocket(`${wsBase}${V3_API_PREFIX}/events?instance=${q(instance)}`, {
        onText(text) {
          try {
            const parsed = eventMessageSchema.safeParse(JSON.parse(text));
            if (parsed.success) handlers.onMessage(parsed.data);
          } catch {
            // a malformed event is ignored; the next tree fetch is the source of truth
          }
        },
        onClose: handlers.onClose,
        onError: (error) => handlers.onError?.(describeFailure(error)),
      });
      return { close: () => socket.close(1000, 'client closed') };
    },
    openTerminal(instance, terminalId, grid, handlers, options) {
      const path = terminalStreamPath(terminalId, clampGrid(grid), instance, options?.control === true);
      const assembler = createFrameAssembler();
      let ping: ReturnType<typeof setInterval> | undefined;
      const stop = () => {
        if (ping) clearInterval(ping);
        ping = undefined;
      };
      const socket = openSocket(`${wsBase}${path}`, {
        onOpen() {
          assembler.reset();
          ping = setInterval(() => socket.sendText(ENCODED_PING), PING_INTERVAL_MS);
        },
        onText(text) {
          const event = assembler.text(text);
          if (event) handlers.onEvent(event);
        },
        onBinary(bytes) {
          const event = assembler.binary(bytes);
          if (event) handlers.onEvent(event);
        },
        onClose(event) {
          stop();
          handlers.onClose({ ...event, gone: event.code === V3_CLOSE_TERMINAL_GONE });
        },
        onError: (error) => handlers.onError?.(describeFailure(error)),
      });
      return {
        sendInput(input) {
          const message = encodeInput(input);
          if (message === null) return false;
          socket.sendText(message);
          return true;
        },
        resize(next) {
          const message = encodeResize(clampGrid(next));
          if (message === null) return false;
          socket.sendText(message);
          return true;
        },
        scroll(lines) {
          const message = encodeScroll(lines);
          if (message === null) return false;
          socket.sendText(message);
          return true;
        },
        mouse(action, col, row) {
          const message = encodeMouse(action, col, row);
          if (message === null) return false;
          socket.sendText(message);
          return true;
        },
        tap(col, row) {
          const message = encodeTap(col, row);
          if (message === null) return false;
          socket.sendText(message);
          return true;
        },
        close() {
          stop();
          socket.close(1000, 'client closed');
        },
      };
    },
  };
}
