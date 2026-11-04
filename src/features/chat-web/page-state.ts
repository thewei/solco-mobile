// [INPUT]: a Host chat frame (state + agentStatus + interaction), the stream phase, the prompt the user just sent
//          (its echo, plus whether that delivery has settled), and the launch-pending hints (a `waiting` override
//          and the pane's tree status) for a conversation the Host has not framed yet.
// [OUTPUT]: `toPageState` — the `ChatBridgeState` the desktop Chat page renders (solco/frontend `mygo.ts`), built from
//           what the Host already serves; `dispositionOf` — Herdr's agent status as the page's send disposition.
// [POS]: pure adapter between Host v3 and the shared Chat page. No React, no Host client, no WebView.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
// Invariants: the page never sees a field the Host did not state; what the phone cannot do is switched
//             off here by leaving the field out, never faked.
import type { ChatCatalog, ChatFrame, ChatInteraction, ChatState, ChatTurn } from '@/contracts/host-v3';

export type PageDisposition = 'ready' | 'queue' | 'terminal' | 'unknown';

/** The wire of solco/frontend's `ChatBridgeInteraction`. */
export interface PageInteraction {
  id: string;
  kind: string;
  prompt: string;
  options: string[];
  header?: string;
  descriptions?: string[];
  progress?: string;
  multi?: boolean;
}

/** The wire of solco/frontend's `ChatFeatures`: what this host of the page can do (the desktop: everything). */
export interface PageFeatures {
  voice: boolean;
  attach: boolean;
  queue: boolean;
  /** Rewriting a stacked row in place (`capabilities.queueEdit`). */
  edit: boolean;
  /** Drag-to-reorder of the stacked queue (`capabilities.queueEdit`). */
  reorder: boolean;
  subagentDrawer: boolean;
}

/** What the phone's Host API serves today; each entry flips on with the Host endpoint behind it. */
export const PHONE_FEATURES: PageFeatures = { voice: false, attach: false, queue: false, edit: false, reorder: false, subagentDrawer: true };

/** The wire of solco/frontend's `ChatCatalog`. */
export interface PageCatalog {
  commands: ChatCatalog['commands'];
  skills: ChatCatalog['skills'];
  models: ChatCatalog['models'];
  canSwitchModel: boolean;
  /** The picker command (`/model`) the Host turns into a card, on Claude Code and Codex. */
  modelPicker?: string;
  defaultModel?: string;
  modelNote?: string;
  /** Thinking-effort choices that do not depend on the model; a model's own `efforts` win. */
  efforts?: ChatCatalog['efforts'];
  effortNote?: string;
}

export const EMPTY_CATALOG: PageCatalog = { commands: [], skills: [], models: [], canSwitchModel: false };

/**
 * The Host's catalog as the page's. A picker command (`/model`, `/permissions` on Claude Code and Codex) is sent as
 * ordinary text and the Host answers with a Question card, exactly as on the desktop. A typed model switch exists
 * only where the agent has a verb (pi, omp, Antigravity); elsewhere the page offers `modelPicker`.
 */
export function toPageCatalog(catalog: ChatCatalog): PageCatalog {
  return {
    commands: catalog.commands,
    skills: catalog.skills,
    models: catalog.models,
    // An effort is one sendable text, so a panel with only efforts is a panel too.
    canSwitchModel: (Boolean(catalog.modelVerb) && catalog.models.length > 0) || (catalog.efforts?.length ?? 0) > 0,
    ...(catalog.modelPicker ? { modelPicker: catalog.modelPicker } : {}),
    ...(catalog.defaultModel ? { defaultModel: catalog.defaultModel } : {}),
    ...(catalog.modelNote ? { modelNote: catalog.modelNote } : {}),
    ...(catalog.efforts?.length ? { efforts: catalog.efforts } : {}),
    ...(catalog.effortNote ? { effortNote: catalog.effortNote } : {}),
  };
}

/** The subset of solco/frontend's `ChatBridgeState` the phone fills in. */
export interface PageState {
  seq: number;
  conversationId: string;
  provider?: string;
  model?: string;
  loading: boolean;
  waiting?: boolean;
  echoPending?: boolean;
  /** The follow-ups parked behind the running turn (the Mac's queue, newest last; `id` is '' only for the local bridge row). */
  queuedItems?: { id: string; text: string; state: string; detail?: string }[];
  /** One line the page shows above the composer (a queued follow-up that did not go through). */
  outcome?: string;
  disposition: PageDisposition;
  theme: 'light' | 'dark';
  outline: boolean;
  /** The changes card's "Review changes" button and file links (the phone's Git view). */
  canReview?: boolean;
  /** The Host's window has earlier messages ("Earlier messages" button). */
  hasOlder?: boolean;
  features: PageFeatures;
  contextTokens?: number;
  /** The window the agent states (Host `state.contextWindow`); absent = none, the page then shows the used count alone. */
  contextWindow?: number;
  interactions?: PageInteraction[];
  plan?: ChatState['plan'];
  subagents?: ChatState['subagents'];
  turns: ChatTurn[];
}

/** idle/done can take a prompt, working takes it through "cut in", blocked/failed needs the terminal. */
export function dispositionOf(status: string | undefined): PageDisposition {
  switch (status) {
    case 'idle':
    case 'done':
      return 'ready';
    case 'working':
      return 'queue';
    case 'blocked':
    case 'failed':
      return 'terminal';
    default:
      return 'unknown';
  }
}

function interactionOf(card: ChatInteraction): PageInteraction {
  return {
    id: card.id,
    kind: card.kind,
    prompt: card.prompt,
    options: card.options,
    ...(card.header ? { header: card.header } : {}),
    ...(card.descriptions ? { descriptions: card.descriptions } : {}),
    ...(card.steps && card.steps > 1 ? { progress: `${(card.step ?? 0) + 1}/${card.steps}` } : {}),
    ...(card.multi ? { multi: true } : {}),
  };
}

function lastUserText(turns: readonly ChatTurn[]): string {
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const turn = turns[i];
    if (turn?.user) return (turn.text ?? '').trim();
  }
  return '';
}

/** True once the Host's turns carry the prompt the user just sent (so the temporary echo can go). */
export function echoConfirmed(frame: ChatFrame | null, echo: string): boolean {
  return frame !== null && lastUserText(frame.state.turns) === echo.trim();
}

export interface PageInput {
  paneId: string;
  seq: number;
  frame: ChatFrame | null;
  /** The pane's own agent status, used while no conversation exists yet. */
  fallbackStatus?: string;
  /** The prompt just delivered; shown as a temporary user row until the transcript confirms it. */
  echo?: string;
  /** The echo row stands but its delivery is no longer in progress (a failed start): no working shimmer. */
  echoSettled?: boolean;
  /** Answered cards stay hidden until the Host's next frame retires them. */
  answeredId?: string | null;
  loading?: boolean;
  /**
   * The no-conversation surface, overriding `!loading`: the page's invite ("Start the conversation" /
   * "`provider` is starting…"). A launch pending with a prompt passes `false` so the transcript (the echo row
   * over its working shimmer) shows instead.
   */
  waiting?: boolean;
  /** Whether this pane's Workspace has a Git view to open (`capabilities.git` and a known Workspace). */
  canReview?: boolean;
  /** A follow-up just queued, shown until the Host's frame carries it. */
  queuedLocal?: string;
  /** A follow-up just cancelled, hidden until the Host's frame stops carrying it. */
  queueCancelled?: boolean;
  /** Rows as just edited/moved, shown while the frame still carries `base` (its items, serialized). */
  queuedOverride?: { base: string; items: NonNullable<PageState['queuedItems']> };
  /** What the page may offer; the phone default hides everything the Host does not serve. */
  features?: PageFeatures;
  /** The agent's display name while no conversation states one (the new-session draft). */
  provider?: string;
  /** One line above the composer (a failed start), overriding the queue view's line. */
  outcome?: string;
}

/** What the page shows for the Host's stacked follow-ups: the rows while they wait, a line when one did not go through. */
function queueView(input: PageInput): Pick<PageState, 'queuedItems' | 'outcome'> {
  const queued = input.queueCancelled ? undefined : input.frame?.queued;
  const uncertain = queued?.items.find((item) => item.state === 'delivery-uncertain');
  if (uncertain) {
    return { outcome: 'The queued follow-up may or may not have been delivered. Check the agent before sending again.' };
  }
  const failed = queued?.items.find((item) => item.state === 'failed-recoverable');
  if (failed) {
    return { outcome: `The queued follow-up could not be delivered${failed.detail ? `: ${failed.detail}` : '.'}` };
  }
  const bridged = queued && input.queuedOverride?.base === JSON.stringify(queued.items) ? input.queuedOverride.items : undefined;
  const items =
    queued && queued.items.length > 0
      ? (bridged ?? queued.items)
      : !input.queueCancelled && input.queuedLocal
        ? [{ id: '', text: input.queuedLocal, state: 'queued' }]
        : undefined;
  return items ? { queuedItems: items } : {};
}

export function toPageState(input: PageInput): PageState {
  const { frame } = input;
  const base = { seq: input.seq, conversationId: input.paneId, theme: 'dark' as const, outline: true, features: input.features ?? PHONE_FEATURES };
  if (!frame) {
    return {
      ...base,
      loading: input.loading ?? false,
      waiting: input.waiting ?? !input.loading,
      disposition: dispositionOf(input.fallbackStatus),
      ...(input.provider ? { provider: input.provider } : {}),
      ...queueView(input),
      ...(input.outcome ? { outcome: input.outcome } : {}),
      ...(input.canReview ? { canReview: true } : {}),
      turns: input.echo?.trim() ? [{ user: true, text: input.echo.trim() }] : [],
      ...(input.echo?.trim() && !input.echoSettled ? { echoPending: true } : {}),
    };
  }
  const { state } = frame;
  const echo = input.echo?.trim() ?? '';
  const pending = echo !== '' && lastUserText(state.turns) !== echo;
  const card = frame.interaction && frame.interaction.id !== input.answeredId ? frame.interaction : undefined;
  return {
    ...base,
    provider: state.provider,
    ...(state.model ? { model: state.model } : {}),
    loading: false,
    disposition: dispositionOf(frame.agentStatus),
    ...queueView(input),
    ...(input.canReview ? { canReview: true } : {}),
    ...(state.hasOlder ? { hasOlder: true } : {}),
    ...(state.contextTokens ? { contextTokens: state.contextTokens } : {}),
    ...(state.contextWindow ? { contextWindow: state.contextWindow } : {}),
    ...(card ? { interactions: [interactionOf(card)] } : {}),
    ...(state.plan ? { plan: state.plan } : {}),
    ...(state.subagents ? { subagents: state.subagents } : {}),
    turns: pending ? [...state.turns, { user: true, text: echo }] : state.turns,
    ...(pending ? { echoPending: true } : {}),
  };
}
