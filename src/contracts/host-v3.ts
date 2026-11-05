// [INPUT]: Solco Go Host `/api/v3` wire payloads (internal/remotehost): pairing, bootstrap, tree,
//          peek, the events socket, the terminal stream's text frames and SC-06 Chat full/delta wire frames.
// [OUTPUT]: The only Zod-validated v3 DTOs plus the wire limits the Host enforces.
// [POS]: Mobile transport contract boundary for the Go Host. Screens never see Herdr protocol types.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
// Wire: v3 is camelCase (set by the Go Host). IDs are opaque strings.
// Pinned by golden files copied verbatim from solco/internal/remotehost/testdata/api-v3
// (`pnpm sync:fixtures`); never edit them by hand.
import { z } from 'zod';

/** Subprotocol pair `['solco.bearer', token]` carries the bearer token on WebSockets. */
export const V3_BEARER_SUBPROTOCOL = 'solco.bearer';
export const V3_API_PREFIX = '/api/v3';
/** WebSocket close code the Host uses when a terminal no longer exists. */
export const V3_CLOSE_TERMINAL_GONE = 4404;

/** Limits the Host validates; mirrored so the client never sends what would be refused. */
export const V3_LIMITS = {
  minCols: 10,
  maxCols: 400,
  minRows: 3,
  maxRows: 200,
  maxInputTextBytes: 64 * 1024,
  maxInputKeys: 32,
  maxTerminalsPerDevice: 2,
  maxChatTextBytes: 64 * 1024,
  maxChatStreamsPerDevice: 4,
  maxLaunchPromptBytes: 64 * 1024,
  maxLaunchPathBytes: 4096,
} as const;

/** Key names are validated by the Host with this exact pattern. */
export const V3_KEY_NAME = /^[A-Za-z0-9+_-]{1,32}$/;

// ---- HTTP ----

export const pairResponseSchema = z.object({
  deviceId: z.string().min(1),
  token: z.string().min(1),
});
export type PairResponse = z.infer<typeof pairResponseSchema>;

export const bootstrapV3Schema = z.object({
  hostId: z.string(),
  hostName: z.string(),
  version: z.string(),
  capabilities: z.object({ terminal: z.boolean(), chat: z.boolean(), launch: z.boolean().optional(), git: z.boolean().optional(), gitWrite: z.boolean().optional(), files: z.boolean().optional(), quota: z.boolean().optional(), automations: z.boolean().optional(), automationsManage: z.boolean().optional(), personalAgent: z.boolean().optional(), personalAgentManage: z.boolean().optional(), personalAgentApprove: z.boolean().optional(), personalAgentGroups: z.boolean().optional(), personalAgentPersona: z.boolean().optional(), personalAgentPlans: z.boolean().optional(), personalAgentRoutines: z.boolean().optional(), personalAgentMemory: z.boolean().optional(), personalAgentProactivity: z.boolean().optional(), personalAgentActivityNotices: z.boolean().optional(), personalAgentNarrativeReports: z.boolean().optional(), sessions: z.boolean().optional(), sessionContinue: z.boolean().optional(), sessionTrash: z.boolean().optional(), voice: z.boolean().optional(), attachments: z.boolean().optional(), queue: z.boolean().optional(), queueEdit: z.boolean().optional(), devices: z.boolean().optional(), remoteDesktop: z.boolean().optional(), p2p: z.boolean().optional() }),
  /** Herdr sessions of the Mac, plus (`capabilities.devices`) the Mac's saved machines as `kind: 'device'` entries with a status. */
  instances: z.array(z.object({ id: z.string().min(1), kind: z.literal('device').optional(), label: z.string().optional(), status: z.string().optional() })),
  /** What POST /launch accepts, `terminal` first; present only when `capabilities.launch`. */
  launchKinds: z.array(z.object({ id: z.string().min(1), label: z.string() })).optional(),
  /**
   * Where the Mac serves right now (`net`), present only while it listens on a
   * LAN/Tailscale address: the phone's card follows a changed address from every
   * successful connect, however it reached the Host. Older Hosts omit the field.
   */
  net: z
    .object({ addresses: z.array(z.object({ host: z.string().min(1), port: z.number().int().min(1).max(65535) })).min(1).max(5) })
    .optional(),
});
export type BootstrapV3 = z.infer<typeof bootstrapV3Schema>;

/** One address the Mac serves on right now (bootstrap `net.addresses`). */
export type HostServingAddress = NonNullable<BootstrapV3['net']>['addresses'][number];

// Statuses are Herdr's own words and may grow: kept as strings, never an enum that would
// make one new value fail the whole tree.
/** One background item: `subagent` (state working | done | stopped; id is the Chat drawer's key) or `service` (state running). */
export const treeBackgroundSchema = z.object({
  kind: z.string(),
  id: z.string().min(1),
  title: z.string(),
  detail: z.string().optional(),
  state: z.string(),
  updatedMs: z.number().int().nonnegative().optional(),
});
export type TreeBackground = z.infer<typeof treeBackgroundSchema>;

export const treeAgentSchema = z.object({
  provider: z.string(),
  status: z.string(),
  /** What the Mac's sidebar calls this agent (session title → name → provider name); absent from older Hosts. */
  title: z.string().optional(),
  /** The Mac's last-worked time for this agent (Unix ms); absent while unknown. */
  lastActiveMs: z.number().int().nonnegative().optional(),
  /** What runs beside the agent: its sub-agents and the service its pane serves (absent from older Hosts). */
  background: z.array(treeBackgroundSchema).optional(),
});
export type TreeAgent = z.infer<typeof treeAgentSchema>;

export const treePaneSchema = z.object({
  paneId: z.string().min(1),
  terminalId: z.string().min(1),
  label: z.string().optional(),
  cwd: z.string().optional(),
  agent: treeAgentSchema.optional(),
});
export type TreePane = z.infer<typeof treePaneSchema>;

export const treeTabSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  status: z.string(),
  panes: z.array(treePaneSchema),
});
export type TreeTab = z.infer<typeof treeTabSchema>;

export const treeWorkspaceSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  status: z.string(),
  cwd: z.string().optional(),
  tabs: z.array(treeTabSchema),
});
export type TreeWorkspace = z.infer<typeof treeWorkspaceSchema>;

export const treeV3Schema = z.object({
  instance: z.string().min(1),
  revision: z.number().int().nonnegative(),
  workspaces: z.array(treeWorkspaceSchema),
});
export type TreeV3 = z.infer<typeof treeV3Schema>;

export const peekSchema = z.object({ paneId: z.string().min(1), line: z.string() });
export type Peek = z.infer<typeof peekSchema>;

export const errorBodyV3Schema = z.object({
  error: z.object({ code: z.string().min(1), message: z.string().optional() }),
});
export type ErrorBodyV3 = z.infer<typeof errorBodyV3Schema>;

// ---- events socket (text frames, host → phone) ----

export const eventMessageSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('hello'), revision: z.number().int().nonnegative() }),
  z.object({ t: z.literal('tree.changed'), revision: z.number().int().nonnegative() }),
  /** Idle-socket heartbeat (every 5 s from the Host): proof the path is alive, never a state change. */
  z.object({ t: z.literal('hb') }),
  /** One step of a Mac automation (the plugin's draft / run started / done / failed): a name and a run id, never text. */
  z.object({
    t: z.literal('automation'),
    kind: z.enum(['draft', 'started', 'done', 'failed']),
    name: z.string().min(1),
    runId: z.string().optional(),
  }),
  /** The Mac's Assistants overview moved: counts only — the phone re-reads the authoritative overview. */
  z.object({
    t: z.literal('personal-agent.changed'),
    revision: z.number().int().positive(),
    assistants: z.number().int().nonnegative(),
    needsYou: z.number().int().nonnegative(),
  }),
]);
export type EventMessage = z.infer<typeof eventMessageSchema>;

// ---- chat (read-only, P2) ----
// Mirrors internal/chatsession (Go): the same projection the desktop page renders.

export const chatToolSchema = z.object({
  name: z.string(),
  input: z.string().optional(),
  output: z.string().optional(),
  isError: z.boolean().optional(),
});

export const chatStepSchema = z.object({
  kind: z.string(),
  text: z.string().optional(),
  toolName: z.string().optional(),
  toolInput: z.string().optional(),
  toolOutput: z.string().optional(),
  toolError: z.boolean().optional(),
  toolDone: z.boolean().optional(),
  tsMs: z.number().optional(),
  subagentIds: z.array(z.string()).optional(),
});

export const chatChangeSchema = z.object({
  path: z.string(),
  additions: z.number().optional(),
  deletions: z.number().optional(),
  counted: z.boolean().optional(),
});

export const chatTurnSchema = z.object({
  user: z.boolean(),
  text: z.string().optional(),
  narration: z.string().optional(),
  thinking: z.string().optional(),
  failed: z.boolean().optional(),
  compacted: z.boolean().optional(),
  /** The context was compacted just before this turn (the page draws a divider). */
  compactedBefore: z.boolean().optional(),
  live: z.boolean().optional(),
  tsMs: z.number().optional(),
  tools: z.array(chatToolSchema).optional(),
  steps: z.array(chatStepSchema).optional(),
  changes: z.array(chatChangeSchema).optional(),
});
export type ChatTurn = z.infer<typeof chatTurnSchema>;

export const chatPlanSchema = z.object({
  items: z.array(z.object({ text: z.string(), status: z.string(), phase: z.string().optional() })),
  turn: z.number().int().nonnegative(),
});

export const subagentCardSchema = z.object({
  id: z.string(),
  provider: z.string(),
  type: z.string().optional(),
  description: z.string().optional(),
  status: z.enum(['running', 'done', 'stopped', 'failed']),
  startedMs: z.number().optional(),
  updatedMs: z.number().optional(),
  toolCalls: z.number().int().nonnegative(),
  tail: z.string().optional(),
  result: z.string().optional(),
  prompt: z.string().optional(),
});

/** One sub-agent's own transcript for the drawer (GET .../chat/subagents/{id}); `error` replaces `turns` when it cannot be shown. */
export const subagentViewSchema = z.object({
  subagent: subagentCardSchema,
  turns: z.array(chatTurnSchema),
  error: z.string().optional(),
});
export type SubagentView = z.infer<typeof subagentViewSchema>;

export const chatStateSchema = z.object({
  provider: z.string(),
  model: z.string().optional(),
  contextTokens: z.number().optional(),
  /** The window the agent states, in tokens (the Host reads it once a minute; absent = none stated). */
  contextWindow: z.number().optional(),
  hasOlder: z.boolean().optional(),
  working: z.boolean().optional(),
  plan: chatPlanSchema.optional(),
  subagents: z.array(subagentCardSchema).optional(),
  turns: z.array(chatTurnSchema),
});
export type ChatState = z.infer<typeof chatStateSchema>;

/** Herdr's agent_status: whether a send can land (idle/done = yes, working = busy, blocked/failed = Terminal). */
const agentStatusSchema = z.string().optional();

/**
 * The card a blocked agent shows (Claude's screen prompt, omp's transcript `ask`). `id` is derived
 * by the Host from pane + source + step + question + options, so an answer to a card that has moved
 * on is refused (`interaction_gone`) instead of landing on the wrong prompt.
 */
export const chatInteractionSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['question', 'permission']),
  header: z.string().optional(),
  prompt: z.string(),
  options: z.array(z.string()).min(1),
  descriptions: z.array(z.string()).optional(),
  multi: z.boolean().optional(),
  /** Options that take a typed answer ("Other (type your own)", "Chat about this"). */
  textOptions: z.array(z.string()).optional(),
  /** One question of a multi-question ask (0-based). */
  step: z.number().int().optional(),
  steps: z.number().int().optional(),
});
export type ChatInteraction = z.infer<typeof chatInteractionSchema>;

/** The follow-ups waiting behind the running turn (the desktop's own stacked queue; absent when nothing is queued). */
export const chatQueuedSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      text: z.string(),
      /** The queue lifecycle verbatim: queued, waiting-for-turn-boundary, delivering, failed-recoverable, delivery-uncertain. */
      state: z.string(),
      detail: z.string().optional(),
    }),
  ),
});
export type ChatQueued = z.infer<typeof chatQueuedSchema>;

/** GET /panes/{paneId}/chat */
export const chatResponseSchema = chatStateSchema.extend({
  paneId: z.string().min(1),
  agentStatus: agentStatusSchema,
  interaction: chatInteractionSchema.optional(),
  queued: chatQueuedSchema.optional(),
});
export type ChatResponse = z.infer<typeof chatResponseSchema>;

/** /panes/{paneId}/chat/stream authoritative whole-state frame. seq is absent on older Hosts. */
export const chatFrameSchema = z.object({
  t: z.literal('chat'),
  paneId: z.string().min(1),
  agentStatus: agentStatusSchema,
  interaction: chatInteractionSchema.optional(),
  queued: chatQueuedSchema.optional(),
  state: chatStateSchema,
  seq: z.number().int().positive().optional(),
});
export type ChatFrame = z.infer<typeof chatFrameSchema>;

/** Bounded OMP suffix update; a gap or invalid baseline requires a full snapshot. */
export const chatDeltaFrameSchema = z.object({
  t: z.literal('chat_delta'),
  paneId: z.string().min(1),
  baseSeq: z.number().int().positive(),
  seq: z.number().int().positive(),
  start: z.number().int().nonnegative(),
  turns: z.array(chatTurnSchema).max(3),
});
export type ChatDeltaFrame = z.infer<typeof chatDeltaFrameSchema>;
export const chatWireFrameSchema = z.discriminatedUnion('t', [chatFrameSchema, chatDeltaFrameSchema]);

/** POST /panes/{paneId}/chat/send — `interrupt` cuts a running turn in (Esc first). */
export const chatSendRequestSchema = z.object({
  text: z
    .string()
    .refine((t) => t.trim().length > 0, 'empty')
    .refine((t) => new TextEncoder().encode(t.trim()).length <= V3_LIMITS.maxChatTextBytes, 'too long'),
  interrupt: z.boolean().optional(),
  /** Park the text behind the running turn (needs `capabilities.queue`); ignored when the agent is ready. */
  queue: z.boolean().optional(),
});
export type ChatSendRequest = z.infer<typeof chatSendRequestSchema>;

/** send/stop answer `{ok:true}`; refusals are `errorBodyV3Schema` with one of these codes. */
export const chatAckSchema = z.object({ ok: z.literal(true) });
export const CHAT_SEND_REFUSALS = ['busy', 'needs_terminal', 'not_ready', 'no_agent', 'refused', 'delivery_uncertain', 'queue_unavailable', 'queue_blocked', 'queue_failed'] as const;

/**
 * POST /panes/{paneId}/chat/answer — a single-select card sends `option` (plus `text` when the row is
 * one of `textOptions`); a multi-select card sends `options` (possibly empty). Answers `{ok:true}`.
 */
export const chatAnswerRequestSchema = z.object({
  interactionId: z.string().min(1),
  option: z.string().optional(),
  options: z.array(z.string()).optional(),
  text: z.string().optional(),
});
export type ChatAnswerRequest = z.infer<typeof chatAnswerRequestSchema>;
export const CHAT_ANSWER_REFUSALS = ['interaction_gone', 'unknown_option', 'bad_request', 'refused', 'delivery_uncertain'] as const;

/**
 * GET /panes/{paneId}/chat/catalog — the agent's own `/` `$` rows and models (mirrors the desktop bridge's
 * ChatCatalog plus `modelVerb`, the typed command that switches model; empty when the agent only has a picker).
 */
export const catalogEntrySchema = z.object({
  name: z.string(),
  insert: z.string(),
  detail: z.string().optional(),
  /** text | picker | terminal | skill | prompt */
  kind: z.string(),
});
/** One thinking-effort choice: `send` is the exact prompt text that applies it (the agent's own typed command). */
const catalogEffortSchema = z.object({ label: z.string(), send: z.string() });
export const chatCatalogSchema = z.object({
  commands: z.array(catalogEntrySchema),
  skills: z.array(catalogEntrySchema),
  /** `efforts` are the model's own levels; `pick` is the text that selects the row when it is not verb+id (Antigravity families). */
  models: z.array(z.object({ id: z.string(), efforts: z.array(catalogEffortSchema).optional(), pick: z.string().optional() })),
  modelVerb: z.string().optional(),
  modelPicker: z.string().optional(),
  defaultModel: z.string().optional(),
  /** The agent saves a model switch / an effort as its default; the page says so under the list. */
  modelNote: z.string().optional(),
  /** Efforts that do not depend on the model (Claude Code); a model's own win. */
  efforts: z.array(catalogEffortSchema).optional(),
  effortNote: z.string().optional(),
});
export type ChatCatalog = z.infer<typeof chatCatalogSchema>;

/** GET …/chat/files — the entry names the composer's `@` token matches in the pane's project folder. */
export const chatFilesSchema = z.object({ files: z.array(z.string()) });
export type ChatFiles = z.infer<typeof chatFilesSchema>;

// ---- launch (P4): start a new session from the phone ----

export const LAUNCH_TERMINAL = 'terminal';
const LAUNCH_REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * POST /launch — `workspaceId` (open a Tab in it) XOR `path` (absolute Mac directory; opens the
 * Workspace for it or creates one). `kind` is `terminal` or one of `launchKinds`. An empty prompt starts
 * the agent only (Terminal: just the shell); a Terminal's prompt is its first command, one line. The same `requestId` never launches twice.
 */
export const launchRequestSchema = z
  .object({
    requestId: z.string().regex(LAUNCH_REQUEST_ID),
    workspaceId: z.string().min(1).optional(),
    path: z
      .string()
      .min(1)
      .refine((p) => new TextEncoder().encode(p).length <= V3_LIMITS.maxLaunchPathBytes, 'too long')
      .optional(),
    kind: z.string().min(1),
    prompt: z
      .string()
      .refine((t) => new TextEncoder().encode(t).length <= V3_LIMITS.maxLaunchPromptBytes, 'too long')
      .optional(),
  })
  .refine((r) => (r.workspaceId === undefined) !== (r.path === undefined), 'exactly one of workspaceId / path')
  .refine((r) => r.kind !== LAUNCH_TERMINAL || !/[\u0000-\u001f\u007f]/.test(r.prompt ?? ''), 'terminal command is one line');
export type LaunchRequest = z.infer<typeof launchRequestSchema>;

export const launchResponseSchema = z.object({
  paneId: z.string().min(1),
  terminalId: z.string(),
  workspaceId: z.string(),
  /** true when the pane runs an agent (open Chat), false for a plain shell (open Terminal). */
  agent: z.boolean(),
  /** true when the agent started but is blocked on its user (a first-run trust prompt) and the prompt was NOT delivered. */
  promptPending: z.boolean().optional(),
});
export type LaunchResponse = z.infer<typeof launchResponseSchema>;

// ---- Voice dictation (present only when `capabilities.voice`) ----

/** POST /voice/transcribe — one recorded clip (base64) for the Mac's own Voice source; the phone holds no credential. */
export const voiceRequestSchema = z.object({ dataBase64: z.string().min(1), mime: z.string().optional() });
export type VoiceRequest = z.infer<typeof voiceRequestSchema>;
export const voiceResponseSchema = z.object({ text: z.string() });
export type VoiceResponse = z.infer<typeof voiceResponseSchema>;

/** Error codes of POST /voice/transcribe (`voice_unavailable`: no Voice source set up on the Mac). */
export const VOICE_REFUSALS = ['voice_unavailable', 'bad_request', 'audio_too_large', 'transcribe_failed'] as const;

// ---- Chat attachments (present only when `capabilities.attachments`) ----

/** One uploaded file; the Host saves it on the Mac and answers the absolute path the draft carries as `@path`. */
export const attachRequestSchema = z.object({
  dataBase64: z.string().min(1),
  mime: z.string().optional(),
  name: z.string().optional(),
});
export type AttachRequest = z.infer<typeof attachRequestSchema>;

export const attachReplySchema = z.object({ path: z.string().min(1) });
export type AttachReply = z.infer<typeof attachReplySchema>;

// ---- Devices (the Mac's saved machines; present only when `capabilities.devices`) ----

/** `status` words of a device entry. `connected` = the Mac's bridge is up and the phone can address it. */
export const DEVICE_STATUSES = ['connected', 'online', 'needs_signin', 'unreachable', 'disabled', 'checking'] as const;

/** POST /devices/{profileId}/connect: the instance key the phone then addresses with `?instance=`. */
export const deviceConnectResponseSchema = z.object({ instance: z.string().min(1) });
export type DeviceConnectResponse = z.infer<typeof deviceConnectResponseSchema>;

export const DEVICE_REFUSALS = ['unknown_device', 'device_disabled', 'device_needs_signin', 'device_unreachable', 'device_herdr_down', 'device_connect_failed', 'devices_unavailable'] as const;

// ---- Git (read-only Changes view; present only when `capabilities.git`) ----

export const gitFileSchema = z.object({
  path: z.string().min(1),
  oldPath: z.string().optional(),
  /** modified|added|deleted|renamed|copied|typechange|conflicted|untracked — Git's own words, kept open. */
  status: z.string(),
  staged: z.boolean(),
  unstaged: z.boolean(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  binary: z.boolean().optional(),
});
export type GitFile = z.infer<typeof gitFileSchema>;

export const gitStatusSchema = z.object({
  workspaceId: z.string(),
  /** false = the Workspace's folder is not a Git repository (an answer, not an error). */
  repo: z.boolean(),
  branch: z.string().optional(),
  detached: z.boolean().optional(),
  head: z.string().optional(),
  upstream: z.object({ name: z.string(), ahead: z.number().int(), behind: z.number().int() }).optional(),
  files: z.array(gitFileSchema),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  /** more files exist than the list carries */
  truncated: z.boolean().optional(),
});
export type GitStatus = z.infer<typeof gitStatusSchema>;

export const gitLineSchema = z.object({
  /** "+" added, "-" removed, " " context */
  k: z.enum(['+', '-', ' ']),
  o: z.number().int().optional(),
  n: z.number().int().optional(),
  t: z.string(),
});
export type GitLine = z.infer<typeof gitLineSchema>;

export const gitDiffSchema = z.object({
  path: z.string(),
  status: z.string(),
  binary: z.boolean().optional(),
  /** past what Git reads on demand: no hunks */
  tooLarge: z.boolean().optional(),
  /** hunks cut to the wire budget */
  truncated: z.boolean().optional(),
  hunks: z.array(z.object({ header: z.string(), lines: z.array(gitLineSchema).nullish() })),
});
export type GitDiff = z.infer<typeof gitDiffSchema>;

/** Error codes of the Git endpoints (`unknown_file`: no longer a changed file — refresh the list). */
export const GIT_REFUSALS = ['git_unavailable', 'unknown_workspace', 'workspace_no_directory', 'unknown_file', 'git_failed', 'bad_request'] as const;

// ---- Git writes (stage / unstage / commit / fetch / pull / push; present only when `capabilities.gitWrite`) ----

/** What a write answers: the repository as it is now (so the list never needs a second round trip), and the new commit's short hash after a commit. */
export const gitWriteResultSchema = z.object({ status: gitStatusSchema, hash: z.string().optional() });
export type GitWriteResult = z.infer<typeof gitWriteResultSchema>;

export const gitCommitRequestSchema = z.object({
  /** one line, ≤200 characters */
  subject: z.string().min(1).max(200),
  body: z.string().max(16 * 1024).optional(),
  /** the files to commit (each must be listed by the status the phone reviewed) */
  paths: z.array(z.string().min(1)).min(1).max(500),
  /** the short HEAD hash the phone reviewed: a moved HEAD refuses with `git_stale` */
  head: z.string().max(40).optional(),
});
export type GitCommitRequest = z.infer<typeof gitCommitRequestSchema>;

export const GIT_SYNC_OPS = ['fetch', 'pull', 'push'] as const;
export type GitSyncOp = (typeof GIT_SYNC_OPS)[number];

/** Refusals of the write endpoints, on top of GIT_REFUSALS (Git's own text never travels: the code is the whole answer). */
export const GIT_WRITE_REFUSALS = [
  'git_write_unavailable',
  'git_stale',
  'git_hook_failed',
  'git_merge_in_progress',
  'git_locked',
  'git_rejected',
  'git_no_upstream',
  'git_detached',
  'git_timeout',
] as const;

// ---- Files (read-only folder browser; present only when `capabilities.files`) ----

export const fileEntrySchema = z.object({
  name: z.string().min(1),
  /** slash-separated, relative to the Workspace's folder */
  path: z.string().min(1),
  /** dir | file | symlink (a link is shown, never walked into) */
  kind: z.string(),
  /** bytes; 0 for a folder */
  size: z.number().int().nonnegative(),
});
export type FileEntry = z.infer<typeof fileEntrySchema>;

export const filesListSchema = z.object({
  workspaceId: z.string(),
  /** "" = the Workspace folder itself */
  dir: z.string(),
  entries: z.array(fileEntrySchema),
  /** more entries exist than the list carries */
  truncated: z.boolean().optional(),
});
export type FilesList = z.infer<typeof filesListSchema>;

export const fileContentSchema = z.object({
  workspaceId: z.string(),
  path: z.string().min(1),
  name: z.string(),
  /** text | markdown | image | binary */
  flavor: z.string(),
  size: z.number().int().nonnegative(),
  /** the text was cut to the wire budget (1 MiB) */
  truncated: z.boolean().optional(),
  /** an image past what the phone takes: no data */
  tooLarge: z.boolean().optional(),
  content: z.string().optional(),
  dataUrl: z.string().optional(),
});
export type FileContent = z.infer<typeof fileContentSchema>;

/** Error codes of the Files endpoints (`bad_request`: a path outside the folder, or the wrong kind of entry). */
export const FILES_REFUSALS = ['files_unavailable', 'unknown_workspace', 'workspace_no_directory', 'unknown_file', 'files_failed', 'bad_request'] as const;

// ---- Quota (read-only; present only when `capabilities.quota`) ----
// The Mac's own agent-quota page as the phone draws it: every provider in the page's order,
// each with its last reading and why the latest attempt did or did not refresh it.

export const quotaWindowSchema = z.object({
  name: z.string(),
  /** 0..100 */
  usedPct: z.number(),
  /** length of the window (ms); absent when the vendor does not say */
  spanMs: z.number().int().nonnegative().optional(),
  /** epoch ms; absent when unknown */
  resetsAtMs: z.number().int().nonnegative().optional(),
  /** optional "$11.60 of $20" / "186 of 300" */
  amount: z.string().optional(),
  /** a counted allowance ("124 of 500 requests"); `max` 0 means a plain share */
  used: z.number().optional(),
  max: z.number().optional(),
  unit: z.string().optional(),
  /** windows of one model set render as one block */
  group: z.string().optional(),
  /** a sub-limit of the main allowance (a per-model weekly cap) */
  minor: z.boolean().optional(),
});
export type QuotaWindow = z.infer<typeof quotaWindowSchema>;

export const quotaProviderSchema = z.object({
  id: z.string().min(1),
  /** disabled|idle|live|setup|expired|rate_limited|unavailable|custom_endpoint — the Host's words, kept open. */
  state: z.string(),
  /** short, secret-free reason */
  detail: z.string().optional(),
  plan: z.string().optional(),
  windows: z.array(quotaWindowSchema),
  notes: z.array(z.string()).optional(),
  /** the reading's own moment (epoch ms) */
  atMs: z.number().int().nonnegative().optional(),
  /** the latest attempt (epoch ms) */
  checkedMs: z.number().int().nonnegative().optional(),
  /** rate_limited: when to try again (epoch ms) */
  retryAtMs: z.number().int().nonnegative().optional(),
});
export type QuotaProvider = z.infer<typeof quotaProviderSchema>;

export const quotaSchema = z.object({ providers: z.array(quotaProviderSchema) });
export type Quota = z.infer<typeof quotaSchema>;

// ---- Automations (read-only; present only when `capabilities.automations`) ----
// The Mac's plugin is the authority; this is its list as the desktop page shows it, without prompts,
// rationale or error text. Times are epoch milliseconds.

export const automationRunSchema = z.object({
  id: z.string(),
  /** The plugin's own word: running | done | failed | queued | skipped | missed | cancelled … */
  status: z.string(),
  atMs: z.number().int().nonnegative().optional(),
  durationSec: z.number().int().nonnegative().optional(),
});
export type AutomationRun = z.infer<typeof automationRunSchema>;

export const automationItemSchema = z.object({
  name: z.string().min(1),
  /** draft = waiting for a person's approval on the Mac; paused = not scheduled; active = scheduled. */
  state: z.enum(['draft', 'paused', 'active']),
  schedule: z.string().optional(),
  agent: z.string().optional(),
  headless: z.boolean().optional(),
  nextRunMs: z.number().int().nonnegative().optional(),
  lastRun: automationRunSchema.optional(),
  /** The newest run finished and nobody opened it on the Mac. */
  unread: z.boolean().optional(),
});
export type AutomationItem = z.infer<typeof automationItemSchema>;

export const automationsSchema = z.object({
  scheduler: z.boolean(),
  /** The Mac's own brief for an Agent asked to draft an automation (the desktop's "Let an Agent Draft" text). */
  draftPrompt: z.string().optional(),
  /** The agents the Mac can launch, under the id the plugin takes — the form's agent choices. */
  agents: z.array(z.object({ id: z.string(), label: z.string() })).optional(),
  automations: z.array(automationItemSchema),
});
export type Automations = z.infer<typeof automationsSchema>;

// ---- Automations management (present only when `capabilities.automationsManage`) ----
// Every field is the plugin's own vocabulary and is judged by the plugin; zero values are absent on the wire.

/** What the New / Edit form carries. workspace = worktree | root, onOverlap = skip | queue; empty = the plugin's default. */
export const automationFieldsSchema = z.object({
  cron: z.string().optional(),
  repo: z.string().optional(),
  workspace: z.string().optional(),
  agent: z.string().optional(),
  model: z.string().optional(),
  prompt: z.string().optional(),
  rationale: z.string().optional(),
  onOverlap: z.string().optional(),
  headless: z.boolean().optional(),
  timeoutMinutes: z.number().int().nonnegative().optional(),
  catchUpMinutes: z.number().int().nonnegative().optional(),
  cleanupTtlHours: z.number().int().nonnegative().optional(),
});
export type AutomationFields = z.infer<typeof automationFieldsSchema>;

/** One run of the detail's history — no error text; a failed run's pane says why. */
export const automationRunInfoSchema = z.object({
  id: z.string(),
  status: z.string(),
  trigger: z.string().optional(),
  atMs: z.number().int().nonnegative().optional(),
  durationSec: z.number().int().nonnegative().optional(),
  agent: z.string().optional(),
  workspaceId: z.string().optional(),
  paneId: z.string().optional(),
  unread: z.boolean().optional(),
});
export type AutomationRunInfo = z.infer<typeof automationRunInfoSchema>;

/** GET /automations/{name}: the whole automation plus its newest runs. */
export const automationDetailSchema = automationFieldsSchema.extend({
  name: z.string().min(1),
  state: z.enum(['draft', 'paused', 'active']),
  schedule: z.string().optional(),
  nextRunMs: z.number().int().nonnegative().optional(),
  runs: z.array(automationRunInfoSchema),
});
export type AutomationDetail = z.infer<typeof automationDetailSchema>;

/** The write body of POST /automations (a draft; name required) and POST /automations/{name}/save (name ignored). */
export const automationWriteSchema = automationFieldsSchema.extend({ name: z.string().min(1).max(80) });
export type AutomationWrite = z.infer<typeof automationWriteSchema>;

export type AutomationOp = 'approve' | 'run' | 'pause' | 'resume' | 'delete';

/** Codes of the management endpoints (`automation_refused` carries the plugin's own words as the error message). */
export const AUTOMATION_REFUSALS = ['automation_unavailable', 'unknown_automation', 'automation_refused', 'automation_failed', 'bad_request'] as const;

// ---- Assistants (Personal Agent; present only when `capabilities.personalAgent`) ----
// The Mac's Go core (SQLite, one writer) is the authority; every state word below is the core's own.
// Times are epoch milliseconds, ids are opaque (`a_ g_ c_ t_ r_ m_ p_` + hex). Writes carry a requestId
// (a replay returns the first receipt), an expectedRevision (a moved revision is 409 `stale_revision`)
// and, for approvals, the exact `actionHash` the card showed.

export const assistantSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  rolePrompt: z.string(),
  scope: z.string(),
  workspaceRefs: z.array(z.string()),
  coordinatorSession: z.string(),
  defaultPolicy: z.string(),
  /** active | paused */
  status: z.string(),
  revision: z.number().int().positive(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export type Assistant = z.infer<typeof assistantSchema>;

export const assistantCommitmentSchema = z.object({
  id: z.string(),
  assistantId: z.string(),
  goalId: z.string(),
  /** pr_watch | … (the core's kinds) */
  kind: z.string(),
  successCriteria: z.string(),
  exitCondition: z.string(),
  spec: z.string(),
  state: z.string(),
  nextCheckAt: z.number().int().nonnegative(),
  lastCheckedAt: z.number().int().nonnegative(),
  lastError: z.string(),
  cursor: z.string(),
  revision: z.number().int().positive(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export type AssistantCommitment = z.infer<typeof assistantCommitmentSchema>;

export const assistantGoalSchema = z.object({
  id: z.string(),
  assistantId: z.string(),
  title: z.string(),
  objective: z.string(),
  /** draft | active | paused | completed | cancelled */
  state: z.string(),
  evidence: z.string(),
  commitments: z.array(assistantCommitmentSchema),
  revision: z.number().int().positive(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export type AssistantGoal = z.infer<typeof assistantGoalSchema>;

export const assistantTaskSchema = z.object({
  id: z.string(),
  assistantId: z.string(),
  goalId: z.string(),
  ruleId: z.string(),
  parentTaskId: z.string(),
  kind: z.string(),
  title: z.string(),
  brief: z.string(),
  repoPath: z.string(),
  agent: z.string(),
  model: z.string(),
  /** draft | queued | claimed | starting | running | blocked | review_required | done | failed | cancelled | uncertain */
  state: z.string(),
  needsYou: z.boolean(),
  reviewState: z.string(),
  attempt: z.number().int().nonnegative(),
  revision: z.number().int().positive(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

export const assistantRunSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  ruleId: z.string(),
  eventId: z.string(),
  idempotencyKey: z.string(),
  status: z.string(),
  claimant: z.string(),
  /** The real Herdr identity of the run: match it against the tree, never against a title. */
  herdrSession: z.string(),
  workspaceId: z.string(),
  paneId: z.string(),
  agentSessionId: z.string(),
  label: z.string(),
  result: z.string(),
  error: z.string(),
  createdAt: z.number().int().nonnegative(),
  startedAt: z.number().int().nonnegative(),
  finishedAt: z.number().int().nonnegative(),
});
export type AssistantRun = z.infer<typeof assistantRunSchema>;

/** A task with its runs (the Assistant page carries runs only for open tasks; GET /tasks/{id} always). */
export const assistantTaskWithRunsSchema = assistantTaskSchema.extend({ runs: z.array(assistantRunSchema) });
export type AssistantTask = z.infer<typeof assistantTaskWithRunsSchema>;

export const assistantMemorySchema = z.object({
  id: z.string(),
  assistantId: z.string(),
  scope: z.string(),
  kind: z.string(),
  content: z.string(),
  sourceRef: z.string(),
  state: z.string(),
  sharedWith: z.array(z.string()),
  revision: z.number().int().positive(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export type AssistantMemory = z.infer<typeof assistantMemorySchema>;

export const assistantApprovalSchema = z.object({
  id: z.string(),
  assistantId: z.string(),
  subjectKind: z.string(),
  subjectId: z.string(),
  /** The exact action the card describes. */
  action: z.string(),
  /** sha256 of the action: the decision must echo it. */
  actionHash: z.string().length(64),
  expectedRevision: z.number().int().positive(),
  expiresAt: z.number().int().nonnegative(),
  /** pending | approved | denied | expired | stale */
  state: z.string(),
  decidedAt: z.number().int().nonnegative(),
  createdAt: z.number().int().nonnegative(),
});
export type AssistantApproval = z.infer<typeof assistantApprovalSchema>;

export const assistantOverviewRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string(),
  revision: z.number().int().positive(),
  tasks: z.number().int().nonnegative(),
  queued: z.number().int().nonnegative(),
  running: z.number().int().nonnegative(),
  needsYou: z.number().int().nonnegative(),
  done: z.number().int().nonnegative(),
  goals: z.number().int().nonnegative(),
  approvals: z.number().int().nonnegative(),
  /** Last activity of the Assistant or any of its tasks (an older Host omits it). */
  updatedAt: z.number().int().nonnegative().default(0),
});
export type AssistantOverviewRow = z.infer<typeof assistantOverviewRowSchema>;

export const groupMemberSchema = z.object({ assistantId: z.string(), name: z.string(), status: z.string() });
export type GroupMember = z.infer<typeof groupMemberSchema>;

/** One Group's light row in the overview: members, log length, @-mentions still on their way. */
export const assistantOverviewGroupSchema = z.object({
  id: z.string(),
  title: z.string(),
  members: z.array(groupMemberSchema),
  lastSeq: z.number().int().nonnegative(),
  open: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export type AssistantOverviewGroup = z.infer<typeof assistantOverviewGroupSchema>;

export const assistantOverviewSchema = z.object({
  schema: z.literal(1),
  assistants: z.array(assistantOverviewRowSchema),
  needsYou: z.number().int().nonnegative(),
  /** Latest committed Activity fact: hint only, never an ACK or a transcript. Older Hosts omit it. */
  activitySeq: z.number().int().nonnegative().optional(),
  /** Absent on a Mac that predates Groups. */
  groups: z.array(assistantOverviewGroupSchema).default([]),
});
export type AssistantOverview = z.infer<typeof assistantOverviewSchema>;

export const assistantsListSchema = z.object({ schema: z.literal(1), assistants: z.array(assistantSchema) });

/**
 * The Assistant's Coordinator — its conversation. `state`: none | starting | ready | stopped | failed (the core's words);
 * `herdrSession` + `paneId` locate the real Herdr pane it runs in once ready.
 */
export const assistantCoordinatorSchema = z.object({
  assistantId: z.string(),
  state: z.string(),
  taskId: z.string().optional(),
  herdrSession: z.string().optional(),
  workspaceId: z.string().optional(),
  paneId: z.string().optional(),
  agentSessionId: z.string().optional(),
  revision: z.number().int().nonnegative(),
});
export type AssistantCoordinator = z.infer<typeof assistantCoordinatorSchema>;

/** An Agent a Coordinator may run on (the desktop's own chat-capable, switched-on kinds, last used first). */
export const assistantAgentKindSchema = z.object({ id: z.string(), label: z.string() });
export type AssistantAgentKind = z.infer<typeof assistantAgentKindSchema>;

/** POST /personal-agent/assistants/{id}/coordinator/start → the Coordinator, `starting`. */
export const assistantCoordinatorReceiptSchema = z.object({ schema: z.literal(1), coordinator: assistantCoordinatorSchema });

/** GET /personal-agent/assistants/{id}: one Assistant's page, isolated per Assistant by the core. */
export const assistantDetailSchema = z.object({
  assistant: assistantSchema,
  coordinator: assistantCoordinatorSchema,
  agents: z.array(assistantAgentKindSchema),
  goals: z.array(assistantGoalSchema),
  tasks: z.array(assistantTaskWithRunsSchema),
  approvals: z.array(assistantApprovalSchema),
  memory: z.array(assistantMemorySchema),
});
export type AssistantDetail = z.infer<typeof assistantDetailSchema>;

export const assistantGoalsSchema = z.object({ schema: z.literal(1), goals: z.array(assistantGoalSchema) });
export const assistantApprovalsSchema = z.object({ schema: z.literal(1), approvals: z.array(assistantApprovalSchema) });

/** The receipts of the writes: the changed record, never a copy of state. */
export const assistantReceiptSchema = z.object({ schema: z.literal(1), assistant: assistantSchema });
export const assistantGoalReceiptSchema = z.object({ schema: z.literal(1), goal: assistantGoalSchema });
export const assistantTaskReceiptSchema = z.object({ schema: z.literal(1), task: assistantTaskSchema });
export type AssistantTaskReceipt = z.infer<typeof assistantTaskReceiptSchema>;
export const assistantApprovalReceiptSchema = z.object({ schema: z.literal(1), approval: assistantApprovalSchema });

/** POST /personal-agent/approvals/{id}/decision */
export const assistantDecisionRequestSchema = z.object({
  requestId: z.string().min(1).max(128),
  actionHash: z.string().length(64),
  approve: z.boolean(),
});
export type AssistantDecisionRequest = z.infer<typeof assistantDecisionRequestSchema>;

export type AssistantGoalAction = 'approve' | 'pause' | 'resume' | 'cancel';
export type AssistantTaskAction = 'ack' | 'retry' | 'publish';

// ---- Groups (`capabilities.personalAgentGroups`): a real multi-author conversation owned by the Mac's Go core ----
// Only the person's exact @-mention wakes an Assistant; an Assistant speaks only through its own live Agent, so the phone has no
// "say" call. A `fact` row is a receipt the core wrote itself (never a member's words); a `task` row follows a live task.

export const groupSchema = z.object({
  id: z.string(),
  title: z.string(),
  /** active | archived */
  status: z.string(),
  members: z.array(groupMemberSchema),
  lastSeq: z.number().int().nonnegative(),
  revision: z.number().int().positive(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export type Group = z.infer<typeof groupSchema>;

/** The core's own receipt: agent_starting | agent_blocked | agent_failed | delivery_failed | delivery_uncertain | delivery_skipped | assistant_disabled | member_added | member_removed | delivered … */
export const groupFactSchema = z.object({
  event: z.string(),
  assistantId: z.string().optional(),
  name: z.string().optional(),
  deliveryId: z.string().optional(),
  reason: z.string().optional(),
});
export type GroupFact = z.infer<typeof groupFactSchema>;

export const groupMessageSchema = z.object({
  seq: z.number().int().positive(),
  id: z.string(),
  groupId: z.string(),
  /** user | assistant | system */
  authorKind: z.string(),
  authorId: z.string().optional(),
  /** text | fact | task */
  kind: z.string(),
  body: z.string(),
  mentions: z.array(z.string()),
  replyTo: z.string().optional(),
  taskId: z.string().optional(),
  fact: groupFactSchema.optional(),
  createdAt: z.number().int().nonnegative(),
});
export type GroupMessage = z.infer<typeof groupMessageSchema>;

/** queued | delivering | delivered | failed | skipped | uncertain */
export const groupDeliverySchema = z.object({
  id: z.string(),
  messageId: z.string(),
  assistantId: z.string(),
  state: z.string(),
  attempts: z.number().int().nonnegative(),
});
export type GroupDelivery = z.infer<typeof groupDeliverySchema>;

export const groupTaskCardSchema = z.object({
  taskId: z.string(),
  assistantId: z.string(),
  title: z.string(),
  state: z.string(),
  needsYou: z.boolean(),
  updatedAt: z.number().int().nonnegative(),
});
export type GroupTaskCard = z.infer<typeof groupTaskCardSchema>;

/** none | starting | ready | blocked | failed | stopped — the Agent an Assistant runs for this Group. */
export const groupAgentStateSchema = z.object({ assistantId: z.string(), state: z.string(), paneId: z.string().optional() });
export type GroupAgentState = z.infer<typeof groupAgentStateSchema>;

export const groupFeedSchema = z.object({
  group: groupSchema,
  messages: z.array(groupMessageSchema),
  deliveries: z.array(groupDeliverySchema),
  tasks: z.array(groupTaskCardSchema),
  agents: z.array(groupAgentStateSchema),
  seq: z.number().int().nonnegative(),
});
export type GroupFeed = z.infer<typeof groupFeedSchema>;

export const groupsListSchema = z.object({ schema: z.literal(1), groups: z.array(groupSchema) });
export const groupFeedResponseSchema = z.object({ schema: z.literal(1), feed: groupFeedSchema });
export const groupReceiptSchema = z.object({ schema: z.literal(1), group: groupSchema });
export const groupPostResponseSchema = z.object({
  schema: z.literal(1),
  result: z.object({ message: groupMessageSchema, deliveries: z.array(groupDeliverySchema) }),
});
export type GroupPostResult = z.infer<typeof groupPostResponseSchema>['result'];

/** POST /personal-agent/groups/{id}/messages */
export const groupMessageRequestSchema = z.object({
  requestId: z.string().min(1).max(128),
  body: z.string().min(1),
  mentions: z.array(z.string()).optional(),
  replyTo: z.string().optional(),
});
export type GroupMessageRequest = z.infer<typeof groupMessageRequestSchema>;

/** GET /personal-agent/inbox — what needs a person, ranked by the core (title and a fixed phrase only, never a prompt). */
export const assistantInboxItemSchema = z.object({
  id: z.string(),
  /** failed_start | stalled | review | needs_you | approval | news … — the core's own vocabulary, shown as given. */
  kind: z.string(),
  assistantId: z.string(),
  taskId: z.string().optional(),
  approvalId: z.string().optional(),
  title: z.string(),
  detail: z.string(),
  priority: z.number().int().nonnegative(),
  at: z.number().int().nonnegative(),
});
export const assistantInboxSchema = z.object({
  schema: z.literal(1),
  items: z.array(assistantInboxItemSchema),
  needsYou: z.number().int().nonnegative(),
  seq: z.number().int().nonnegative(),
});
export type AssistantInboxItem = z.infer<typeof assistantInboxItemSchema>;
export type AssistantInbox = z.infer<typeof assistantInboxSchema>;

/** One commitment of a Goal draft — the PR Watch spec is JSON the core validates. */
export const assistantCommitmentInputSchema = z.object({
  kind: z.string().min(1).max(40),
  successCriteria: z.string().optional(),
  exitCondition: z.string().optional(),
  spec: z.string().optional(),
});
export type AssistantCommitmentInput = z.infer<typeof assistantCommitmentInputSchema>;

// ---- Persona (`capabilities.personalAgentPersona`): how one Assistant works — owned by the Mac's Go core ----
// Instructions are versioned (a save is a new revision and reaches Agents started afterwards); the runtime profile is the
// Agent/Model/Effort new starts use, beside the Agents that really run; MCP keeps four facts apart: configured (in the person's
// own config), granted (to this Assistant), bound (handed to a launch) and verified (only the Agent's own startup report).

export const instructionRevisionSchema = z.object({
  revision: z.number().int().positive(),
  /** default | user | restore */
  source: z.string(),
  body: z.string(),
  createdAt: z.number().int().nonnegative(),
});
export const instructionsSchema = z.object({
  assistantId: z.string(),
  revision: z.number().int().positive(),
  body: z.string(),
  history: z.array(instructionRevisionSchema),
  /** the revision each running surface was launched with (`coordinator`, `group:<id>`, `task`) */
  applied: z.array(z.object({ surface: z.string(), revision: z.number().int().positive(), appliedAt: z.number().int().nonnegative() })),
});
export type Instructions = z.infer<typeof instructionsSchema>;
export const instructionsResponseSchema = z.object({ schema: z.literal(1), instructions: instructionsSchema, replayed: z.boolean().optional() });

export const runtimeProfileSchema = z.object({
  assistantId: z.string(),
  agent: z.string(),
  model: z.string(),
  effort: z.string(),
  /** whether this Agent's launch takes a thinking effort at all */
  effortSupported: z.boolean(),
  revision: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export const runningAgentSchema = z.object({
  surface: z.string(),
  taskId: z.string(),
  agent: z.string(),
  model: z.string(),
  state: z.string(),
  paneId: z.string().optional(),
});
export const runtimeSchema = z.object({ profile: runtimeProfileSchema, running: z.array(runningAgentSchema) });
export type Runtime = z.infer<typeof runtimeSchema>;
export const runtimeResponseSchema = z.object({ schema: z.literal(1), runtime: runtimeSchema, replayed: z.boolean().optional() });

/** Names, transport and program/host only — never arguments, environment, headers or URL paths. */
export const mcpServerStateSchema = z.object({
  id: z.string(),
  name: z.string(),
  transport: z.string(),
  summary: z.string(),
  sources: z.array(z.string()),
  /** which Agents' own configuration lists it: claude | codex */
  agents: z.array(z.string()),
  configured: z.boolean(),
  granted: z.boolean(),
  /** the surfaces whose last launch was handed this server */
  bound: z.array(z.string()),
  /** the Agent's own startup status ("connected", "failed", …); empty = never checked */
  verified: z.string(),
  verifiedAt: z.number().int().nonnegative(),
});
export type McpServerState = z.infer<typeof mcpServerStateSchema>;
export const mcpViewSchema = z.object({
  assistantId: z.string(),
  agent: z.string(),
  supported: z.boolean(),
  unsupported: z.string().optional(),
  servers: z.array(mcpServerStateSchema),
  bindings: z.array(
    z.object({
      surface: z.string(),
      agent: z.string(),
      servers: z.array(z.string()),
      strict: z.boolean(),
      unsupported: z.string().optional(),
      boundAt: z.number().int().nonnegative(),
    }),
  ),
});
export type McpView = z.infer<typeof mcpViewSchema>;
export const mcpResponseSchema = z.object({ schema: z.literal(1), mcp: mcpViewSchema, replayed: z.boolean().optional() });

// ---- Goal plans + ledger (`capabilities.personalAgentPlans`, read-only): what the Mac's core knows about a Goal ----
// A plan is success criteria + milestones; each milestone's state is derived by the core from the real task behind it
// (verified only when that task is done — a coding task: merged). Facts are sentences the core wrote about committed state;
// they are the system's record, never an Agent's reply.

export const milestoneStates = ['pending', 'working', 'verifying', 'verified', 'blocked', 'needs_you'] as const;
export const milestoneViewSchema = z.object({
  id: z.string(),
  title: z.string(),
  dependsOn: z.array(z.string()).optional(),
  task: z.object({ kind: z.string(), title: z.string(), brief: z.string(), repoPath: z.string().optional(), agent: z.string().optional(), model: z.string().optional() }).optional(),
  taskId: z.string().optional(),
  attempt: z.number().int().nonnegative().optional(),
  state: z.enum(milestoneStates),
  evidence: z.string().optional(),
});
export type MilestoneView = z.infer<typeof milestoneViewSchema>;
export const goalPlanSchema = z.object({
  goalId: z.string(),
  assistantId: z.string(),
  successCriteria: z.string(),
  milestones: z.array(milestoneViewSchema),
  nextAction: z.string(),
  planRevision: z.number().int().positive(),
  replans: z.number().int().nonnegative(),
  maxTasks: z.number().int().positive(),
  staleAfterMs: z.number().int().nonnegative(),
  verified: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  /** draft | paused | completed | cancelled, or for an active Goal working | verifying | blocked | waiting_user | active */
  state: z.string(),
  revisions: z.array(z.object({ revision: z.number().int().positive(), reason: z.string(), milestones: z.number().int().nonnegative(), createdAt: z.number().int().nonnegative() })),
  updatedAt: z.number().int().nonnegative(),
});
export type GoalPlan = z.infer<typeof goalPlanSchema>;
export const factKinds = ['accepted', 'planned', 'replanned', 'delegated', 'verifying', 'verified', 'blocked', 'ready', 'done', 'stale', 'held', 'task_added', 'run_finished', 'pulse', 'routine', 'routine_done', 'routine_failed'] as const;
export const factSchema = z.object({
  seq: z.number().int().positive(),
  id: z.string(),
  assistantId: z.string(),
  goalId: z.string().optional(),
  taskId: z.string().optional(),
  kind: z.string(),
  text: z.string(),
  evidence: z.string().optional(),
  createdAt: z.number().int().nonnegative(),
});
export type Fact = z.infer<typeof factSchema>;
export const goalPlanResponseSchema = z.object({ schema: z.literal(1), plan: goalPlanSchema, facts: z.array(factSchema) });
export const factsResponseSchema = z.object({ schema: z.literal(1), facts: z.array(factSchema) });

// Assistant Activity is a durable, oldest-first system fact stream. A GET
// never marks anything delivered. ACK is per authenticated Host device, not a
// consumer key supplied by this client, and cannot claim OMP said the text.
export const assistantActivityPageSchema = factsResponseSchema.extend({
  nextSeq: z.number().int().nonnegative(),
  ackSeq: z.number().int().nonnegative(),
  hasMore: z.boolean(),
});
export type AssistantActivityPage = z.infer<typeof assistantActivityPageSchema>;
export const assistantActivityAckSchema = z.object({
  schema: z.literal(1),
  ackSeq: z.number().int().nonnegative(),
});

// Herdr accepting a report prompt is not proof the Agent has answered.
// An uncertain delivery can only be resolved through a person's explicit,
// throughSeq-fenced review, never by an automatic retry.
export const coordinatorReportSchema = z.object({
  assistantId: z.string(),
  state: z.enum(['idle', 'queued', 'claimed', 'submitted', 'uncertain']),
  fromSeq: z.number().int().nonnegative().default(0),
  throughSeq: z.number().int().nonnegative().default(0),
  submittedSeq: z.number().int().nonnegative().default(0),
  attempts: z.number().int().nonnegative().default(0),
  nextAt: z.number().int().nonnegative().default(0),
  lastSubmittedAt: z.number().int().nonnegative().default(0),
  lastError: z.string().optional(),
  herdrSession: z.string().optional(),
  workspaceId: z.string().optional(),
  paneId: z.string().optional(),
  coordinatorRevision: z.number().int().nonnegative().default(0),
  updatedAt: z.number().int().nonnegative().default(0),
  // Optional for hosts built before provider-owned reply reconciliation.
  // A submitted Herdr prompt is never assumed to be an OMP answer.
  replyState: z.enum(['untracked', 'awaiting', 'verified', 'interrupted', 'handled']).optional(),
  replySessionId: z.string().optional(),
  replyMessageId: z.string().optional(),
  replyVerifiedAt: z.number().int().nonnegative().optional(),
}).superRefine((report, context) => {
  // Do not render a completion badge from a claimed provider status that
  // lacks the actual OMP session, terminal message ID or verification time.
  if (report.replyState === 'verified' && (!report.replySessionId || !report.replyMessageId || !report.replyVerifiedAt)) {
    context.addIssue({ code: 'custom', message: 'Verified OMP reply requires provider message evidence' });
  }
});
export type CoordinatorReport = z.infer<typeof coordinatorReportSchema>;
export const coordinatorReportResponseSchema = z.object({ schema: z.literal(1), report: coordinatorReportSchema });

// ---- Routines (`capabilities.personalAgentRoutines`, read-only): scheduled work an Assistant drafted ----
// A routine is an automation with an owner. An Assistant only drafts; the enabling is a person's answer to an ordinary
// approval card (subjectKind "routine"), bound to the exact definition. The phone lists them; it has no write path here.

export const routineSchema = z.object({
  name: z.string(),
  assistantId: z.string(),
  /** assistant | user */
  requestedBy: z.string(),
  /** chat | cli */
  source: z.string(),
  correlationId: z.string().optional(),
  /** draft | active | stale | cancelled */
  state: z.string(),
  revision: z.number().int().positive(),
  approved: z.boolean(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  cron: z.string(),
  repo: z.string(),
  agent: z.string(),
  model: z.string().optional(),
  headless: z.boolean(),
  paused: z.boolean(),
  missing: z.boolean().optional(),
  rationale: z.string().optional(),
  prompt: z.string().optional(),
  next: z.number().int().nonnegative().optional(),
  lastState: z.string().optional(),
  lastAt: z.number().int().nonnegative().optional(),
  approvalId: z.string().optional(),
  approvalState: z.string().optional(),
});
export type Routine = z.infer<typeof routineSchema>;
export const routinesResponseSchema = z.object({ schema: z.literal(1), routines: z.array(routineSchema) });

// ---- Memory workspace + proactivity (`capabilities.personalAgentMemory` / `personalAgentProactivity`, Assistants 3.1 U5) ----
// Memory is the Mac core's: the phone adds, edits, approves and forgets one item at a time (each write fenced by the item's
// revision) and reads its versions. The Mac's memory folder (Markdown files) is a projection of the same rows and has no phone
// surface. Proactivity is the Assistant's rules for what the system may start unasked; revision 0 means "never set".

export const memoryReviewSchema = z.object({
  assistantId: z.string(),
  approved: z.number().int().nonnegative(),
  candidates: z.number().int().nonnegative(),
  max: z.number().int().positive(),
  /** Groups of item ids with the same wording. */
  duplicates: z.array(z.array(z.string())),
  staleCandidates: z.array(z.string()),
  /** Candidates holding an edit made on an outdated file. */
  conflicts: z.array(z.string()),
  /** Live items only: approved and candidates. */
  items: z.array(assistantMemorySchema),
});
export type MemoryReview = z.infer<typeof memoryReviewSchema>;
export const memoryReviewResponseSchema = z.object({ schema: z.literal(1), review: memoryReviewSchema });

export const memoryVersionSchema = z.object({
  memoryId: z.string(),
  revision: z.number().int().positive(),
  /** user | agent | files | system — a label, not a proof. */
  author: z.string(),
  state: z.string(),
  content: z.string(),
  at: z.number().int().nonnegative(),
});
export type MemoryVersion = z.infer<typeof memoryVersionSchema>;
export const memoryHistoryResponseSchema = z.object({ schema: z.literal(1), versions: z.array(memoryVersionSchema) });
export const memoryItemResponseSchema = z.object({ schema: z.literal(1), memory: assistantMemorySchema });

export const PROACTIVITY_LEVELS = ['respond', 'suggest', 'follow_up'] as const;
export const proactivitySchema = z.object({
  assistantId: z.string(),
  level: z.string(),
  quietStart: z.string(),
  quietEnd: z.string(),
  tz: z.string(),
  reportEveryMin: z.number().int().nonnegative(),
  dailyBudget: z.number().int().positive(),
  dispatchToday: z.number().int().nonnegative(),
  quietNow: z.boolean(),
  revision: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export type Proactivity = z.infer<typeof proactivitySchema>;
export const proactivityResponseSchema = z.object({ schema: z.literal(1), proactivity: proactivitySchema });
export type ProactivityInput = Pick<Proactivity, 'level' | 'quietStart' | 'quietEnd' | 'tz' | 'reportEveryMin' | 'dailyBudget'>;

/** Codes of the Assistants routes. `personal_agent_unavailable`: gate closed or an older Host; the rest are the core's own stable refusals (409 unless noted). */
export const PERSONAL_AGENT_REFUSALS = [
  'personal_agent_unavailable',
  'personal_agent_failed',
  'request_conflict',
  'stale_revision',
  'not_found',
  'assistant_disabled',
  'busy',
  'not_claimable',
  'bad_state',
  'invalid',
  'uncertain',
  'internal',
  'bad_request',
  'mcp_unsupported',
  'mcp_probe_failed',
] as const;

/** Error code of GET /quota (`quota_unavailable`: an older Host without the view — the capability said so). */
export const QUOTA_REFUSALS = ['quota_unavailable'] as const;

// ---- Sessions (read-only; present only when `capabilities.sessions`) ----
// The Mac's session catalog as metadata (no conversation text): newest first, the sessions an Agent
// is running right now first of all, each carrying the pane that runs it. Search runs on the Mac.

export const sessionRunningSchema = z.object({
  /** the Herdr session (instance) the pane lives in — the Mac window's active one */
  instance: z.string().min(1),
  paneId: z.string().min(1),
  /** the desktop's one status word: working|attention|review|idle (kept open) */
  state: z.string(),
});
export type SessionRunning = z.infer<typeof sessionRunningSchema>;

export const sessionRowSchema = z.object({
  id: z.string().min(1),
  /** provider id: claude-code|codex|pi|omp|cursor|antigravity (kept open) */
  agent: z.string().min(1),
  title: z.string(),
  project: z.string().optional(),
  /** epoch ms */
  updatedMs: z.number().int().nonnegative().optional(),
  messages: z.number().int().nonnegative().optional(),
  running: sessionRunningSchema.optional(),
});
export type SessionRow = z.infer<typeof sessionRowSchema>;

export const sessionsSchema = z.object({ sessions: z.array(sessionRowSchema) });
export type Sessions = z.infer<typeof sessionsSchema>;

/** Error codes of GET /sessions (`sessions_unavailable`: an older Host, or the catalog could not be read). */
export const SESSIONS_REFUSALS = ['sessions_unavailable', 'bad_request'] as const;

/** The pane a continued session runs in (`alreadyLive`: an Agent already held it, nothing was started). */
export const continueResponseSchema = launchResponseSchema.extend({ alreadyLive: z.boolean() });
export type ContinueResponse = z.infer<typeof continueResponseSchema>;

/** Error codes of POST /sessions/{id}/continue (`launch_uncertain`: the Agent may exist — look on the Mac, do not retry blindly). */
export const SESSION_CONTINUE_REFUSALS = [
  'continue_unavailable',
  'bad_request',
  'unknown_session',
  'needs_project',
  'cannot_continue',
  'path_unavailable',
  'launch_conflict',
  'launch_uncertain',
  'launch_failed',
] as const;

// ---- Sessions Trash (present only when `capabilities.sessionTrash`) ----
// The desktop's Sessions Trash, reversible steps only: move a session in, put one back. Permanent
// deletion stays on the Mac. An entry id names the Trash entry (what restore takes), not the session.

export const trashEntrySchema = z.object({
  id: z.string().min(1),
  agent: z.string().min(1),
  title: z.string(),
  project: z.string().optional(),
  /** epoch ms */
  deletedMs: z.number().int().nonnegative().optional(),
  messages: z.number().int().nonnegative().optional(),
});
export type TrashEntry = z.infer<typeof trashEntrySchema>;

export const trashListSchema = z.object({ entries: z.array(trashEntrySchema) });
export type TrashList = z.infer<typeof trashListSchema>;

/** The answer of a move-in and a put-back: the Trash entry concerned. */
export const trashAnswerSchema = z.object({ entry: z.string().min(1) });
export type TrashAnswer = z.infer<typeof trashAnswerSchema>;

/**
 * Error codes of the Trash endpoints (`session_in_use`: an Agent runs it or it was written a moment ago;
 * `session_exists`: put-back would overwrite a file; `trash_unavailable`: no Trash on the Mac).
 */
export const SESSION_TRASH_REFUSALS = [
  'trash_unavailable',
  'bad_request',
  'unknown_session',
  'unknown_entry',
  'session_in_use',
  'session_exists',
  'trash_failed',
] as const;

/** Error codes of POST /launch (`launch_uncertain`: the session may exist — look in the list, do not retry blindly). */
export const LAUNCH_REFUSALS = [
  'launch_unavailable',
  'bad_request',
  'unknown_workspace',
  'workspace_no_directory',
  'path_unavailable',
  'launch_conflict',
  'launch_uncertain',
  'launch_failed',
] as const;

/** Application close codes of the chat stream. */
export const V3_CLOSE_NO_CONVERSATION = 4409;

// ---- terminal stream ----

/** Text frame announcing the binary ANSI frame that follows it. */
export const terminalFrameHeaderSchema = z.object({
  t: z.literal('frame'),
  seq: z.number().int().nonnegative(),
  full: z.boolean(),
  w: z.number().int().positive(),
  h: z.number().int().positive(),
});
export type TerminalFrameHeader = z.infer<typeof terminalFrameHeaderSchema>;

export const terminalServerMessageSchema = z.discriminatedUnion('t', [
  terminalFrameHeaderSchema,
  z.object({ t: z.literal('pong') }),
  z.object({
    t: z.literal('input.error'),
    code: z.enum(['bad_input', 'refused', 'forbidden']),
    message: z.string().optional(),
  }),
]);
export type TerminalServerMessage = z.infer<typeof terminalServerMessageSchema>;

/** What the phone sends upstream (the Host accepts exactly these). */
export const terminalClientMessageSchema = z.discriminatedUnion('t', [
  z.object({
    t: z.literal('input'),
    text: z.string().optional(),
    keys: z.array(z.string().regex(V3_KEY_NAME)).max(V3_LIMITS.maxInputKeys).optional(),
  }),
  z.object({
    t: z.literal('resize'),
    cols: z.number().int().min(V3_LIMITS.minCols).max(V3_LIMITS.maxCols),
    rows: z.number().int().min(V3_LIMITS.minRows).max(V3_LIMITS.maxRows),
  }),
  z.object({ t: z.literal('ping') }),
]);
export type TerminalClientMessage = z.infer<typeof terminalClientMessageSchema>;

// ---- P2P signalling (present only when `capabilities.p2p`) ----

/** One STUN/TURN entry in WebRTC's own shape; `GET /p2p/ice`. */
export const p2pIceServerSchema = z.object({
  urls: z.array(z.string()).min(1),
  username: z.string().optional(),
  credential: z.string().optional(),
});
export const p2pIceSchema = z.object({ iceServers: z.array(p2pIceServerSchema) });
/** `POST /p2p/session` {sdp: offer} → the Mac's answer (non-trickle: its candidates are in the SDP). */
export const p2pSessionSchema = z.object({ sessionId: z.string().min(1), sdp: z.string().min(1) });
export type P2PIceServer = z.infer<typeof p2pIceServerSchema>;
export type P2PSessionAnswer = z.infer<typeof p2pSessionSchema>;

// ---- Remote Desktop (present only when `capabilities.remoteDesktop`) ----
// The Mac's whole desktop, watched and driven from the phone. HTTP only signals (Info, then one SDP
// offer → answer); video flows over WebRTC and input over the two data channels below. Pinned by the
// Go Host's `remote-desktop-*.json` golden files, including every control-channel message.

export const RD_PROTOCOL = 1;
export const RD_CHANNEL_CONTROL = 'control';
export const RD_CHANNEL_POINTER = 'pointer';

export const rdTierSchema = z.enum(['smooth', 'standard', 'high']);
export type RdTier = z.infer<typeof rdTierSchema>;
/** `view` watches only; `full` also drives the Mac (the person at the Mac may downgrade a request). */
export const rdModeSchema = z.enum(['view', 'full']);
export type RdMode = z.infer<typeof rdModeSchema>;

export const rdPermissionsSchema = z.object({ screenRecording: z.boolean(), accessibility: z.boolean() });

export const rdDisplaySchema = z.object({
  id: z.string(),
  name: z.string(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  pixelWidth: z.number().int(),
  pixelHeight: z.number().int(),
  scale: z.number(),
  isMain: z.boolean(),
});
export type RdDisplay = z.infer<typeof rdDisplaySchema>;

/** `GET /remote-desktop` — readiness before connecting. */
export const rdInfoSchema = z.object({
  protocol: z.number().int(),
  state: z.enum(['ready', 'disabled', 'permission_required', 'busy', 'unavailable']),
  platform: z.string().optional(),
  permissions: rdPermissionsSchema,
  requireApproval: z.boolean(),
  tiers: z.array(rdTierSchema),
});
export type RdInfo = z.infer<typeof rdInfoSchema>;

/** `POST /remote-desktop/session` body: a complete (non-trickle) offer with a receive-only video transceiver and both channels. */
export const rdOfferSchema = z.object({
  protocol: z.number().int(),
  sdp: z.string().min(1),
  mode: rdModeSchema.optional(),
  displayId: z.string().optional(),
  tier: rdTierSchema.optional(),
});
export type RdOffer = z.infer<typeof rdOfferSchema>;

const rdStateFields = {
  mode: rdModeSchema,
  displayId: z.string(),
  displays: z.array(rdDisplaySchema),
  tier: rdTierSchema,
  width: z.number().int(),
  height: z.number().int(),
  fps: z.number().int(),
  hardware: z.boolean(),
  /** The Mac's pointer is drawn in the video. */
  cursor: z.boolean(),
  /** The Mac's own screens are blacked out (anti-peek); the picture here is unchanged. */
  blackout: z.boolean().optional(),
  /** The Mac's lock screen is up; `canUnlock` = the Mac holds a saved login password it can type (never sent here). */
  locked: z.boolean().optional(),
  canUnlock: z.boolean().optional(),
};
export const rdSessionStateSchema = z.object(rdStateFields);
export type RdSessionState = z.infer<typeof rdSessionStateSchema>;

export const rdAnswerSchema = z.object({ sessionId: z.string().min(1), sdp: z.string().min(1), state: rdSessionStateSchema });
export type RdAnswer = z.infer<typeof rdAnswerSchema>;

/** Refusal codes of the signalling routes (HostV3Error.code). `approval_timeout`: nobody answered on the Mac. */
export const RD_REFUSALS = [
  'remote_disabled',
  'remote_unavailable',
  'protocol_unsupported',
  'permission_required',
  'denied',
  'approval_timeout',
  'busy',
  'bad_request',
  'bad_offer',
  'display_not_found',
  'helper_failed',
  'internal',
] as const;

/** Mac → phone, on the control channel. */
export const rdStatsSchema = z.object({
  type: z.literal('stats'),
  rttMs: z.number().optional(),
  bitrateKbps: z.number(),
  fps: z.number(),
  framesSent: z.number(),
  framesDropped: z.number(),
  keyframesSent: z.number(),
  keyframeRequests: z.number(),
  pathType: z.string().optional(),
  uptimeSeconds: z.number(),
});
export type RdStats = z.infer<typeof rdStatsSchema>;

export const rdMacMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('session.state'), ...rdStateFields }),
  z.object({ type: z.literal('clipboard.text'), text: z.string() }),
  z.object({
    type: z.literal('error'),
    code: z.enum([...RD_REFUSALS, 'view_only', 'not_connected', 'session_ended', 'capture_failed', 'unlock_unavailable', 'unlock_failed', 'privacy_unavailable']),
    message: z.string().optional(),
  }),
  z.object({ type: z.literal('pong'), t: z.number() }),
  rdStatsSchema,
]);
export type RdMacMessage = z.infer<typeof rdMacMessageSchema>;

export const RD_BUTTONS = ['left', 'right', 'middle'] as const;
export type RdButton = (typeof RD_BUTTONS)[number];

/** Phone → Mac. Pointer coordinates are normalised (0…1) against the video content; `seq` is monotonic per session across both channels. */
export const rdPhoneMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('pointer.move'), seq: z.number().int(), x: z.number(), y: z.number(), displayId: z.string().optional() }),
  z.object({
    type: z.literal('pointer.button'),
    seq: z.number().int(),
    x: z.number(),
    y: z.number(),
    button: z.enum(RD_BUTTONS),
    down: z.boolean(),
    clickCount: z.number().int().min(1).max(3).optional(),
    displayId: z.string().optional(),
  }),
  z.object({ type: z.literal('pointer.scroll'), seq: z.number().int(), dx: z.number(), dy: z.number() }),
  z.object({ type: z.literal('key'), code: z.string().min(1), down: z.boolean() }),
  z.object({ type: z.literal('text.insert'), text: z.string().min(1) }),
  z.object({ type: z.literal('clipboard.set'), text: z.string() }),
  z.object({ type: z.literal('clipboard.get') }),
  z.object({ type: z.literal('display.select'), displayId: z.string() }),
  z.object({ type: z.literal('quality.set'), tier: rdTierSchema }),
  z.object({ type: z.literal('cursor.set'), visible: z.boolean() }),
  z.object({ type: z.literal('privacy.set'), on: z.boolean() }),
  z.object({ type: z.literal('unlock.request') }),
  z.object({ type: z.literal('keyframe.request') }),
  z.object({ type: z.literal('ping'), t: z.number() }),
  z.object({ type: z.literal('session.end') }),
  z.object({ type: z.literal('input.release_all') }),
  z.object({ type: z.literal('stats.request') }),
]);
export type RdPhoneMessage = z.infer<typeof rdPhoneMessageSchema>;

/** Limits the Mac enforces on one message; the client stays under them. */
export const RD_LIMITS = { maxMessageBytes: 64 * 1024, maxTextInsertRunes: 4096, maxClipboardBytes: 256 * 1024, maxScrollDelta: 4000 } as const;
