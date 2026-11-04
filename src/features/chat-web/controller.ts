// [INPUT]: the pane's Host chat stream (phase + frame, plus a pending launch's `waiting`/`echoSettled` hints), the
//          pane's own agent status, and five Host operations (send, stop, answer, catalog, open terminal).
// [OUTPUT]: `createChatController` — owns the `PageState` the shared Chat page renders, stands a handed-over
//           launch prompt in as a user row (`prime`), and answers the page's
//           `chat.*` bridge calls (Snapshot/Send/Stop/InterruptAndSend/AnswerInteraction*/Catalog/SwitchModel/…); every other call is
//           either a harmless empty answer or an explicit "not on the phone yet" refusal.
// [POS]: the phone's counterpart of the desktop `ChatBridge` Go service, minus anything Herdr or the Host does not serve.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
// Invariants: no IO of its own (operations are injected); a refused or failed operation changes nothing but the
//             rejection the page shows; seq grows with every state built so the page drops a stale one.
import type { ChatAnswerRequest, ChatCatalog, ChatFrame, SubagentView } from '@/contracts/host-v3';
import type { PickedAttachment } from '@/lib/attachment';

import { echoConfirmed, EMPTY_CATALOG, PHONE_FEATURES, toPageCatalog, toPageState, type PageCatalog, type PageInput, type PageState } from './page-state';

/** How long a just-sent prompt stands in as a user row before the transcript must have confirmed it. */
export const ECHO_TTL_MS = 20_000;

export interface ChatOps {
  /** Rejects with the sentence the page shows (a Host refusal already mapped to words). */
  send(text: string, interrupt: boolean): Promise<void>;
  stop(): Promise<void>;
  answer(request: ChatAnswerRequest): Promise<void>;
  /** The agent's own `/` `$` rows and models (the Host reads them; nothing runs). */
  catalog(): Promise<ChatCatalog>;
  openTerminal(): void;
  /** Asks the stream for the previous page; the next frame carries it. */
  older(): void;
  /** Entry names of the project folder matching the `@` token. */
  files(token: string): Promise<string[]>;
  /** Whether this pane's Workspace has a Git view on the phone. */
  canReview(): boolean;
  /** Opens it: the Changes list, or that file's diff when `path` names one (client-local navigation). */
  review(path: string): void;
  /** Whether the Host queues follow-ups (`capabilities.queue`); asked on every state. */
  canQueue(): boolean;
  /** Parks the text behind the running turn on the Mac. */
  queue(text: string): Promise<void>;
  /** Withdraws the queued follow-up (all of it). */
  cancelQueued(): Promise<void>;
  /** Withdraws one stacked follow-up by its id (the page hides the ✕ on the local bridge row). */
  cancelQueuedItem(requestId: string): Promise<void>;
  /** Whether the Host rewrites and reorders queued rows (`capabilities.queueEdit`); asked on every state. */
  canEdit(): boolean;
  /** Rewrites one unclaimed stacked follow-up. Rejects with the sentence the page shows. */
  editQueuedItem(requestId: string, text: string): Promise<void>;
  /** Moves one stacked follow-up to list index `to`. */
  moveQueuedItem(requestId: string, to: number): Promise<void>;
  /** One sub-agent's own transcript for the drawer. Rejects with the sentence the page shows. */
  subagent(id: string): Promise<SubagentView>;
  /** Whether the Host takes uploads (`capabilities.attachments`); asked on every state so a late bootstrap shows the entry. */
  canAttach(): boolean;
  /** The system picker; null when the user cancelled. Rejects with the sentence the page shows. */
  pickFile(): Promise<PickedAttachment | null>;
  /** Saves one file on the Mac and resolves with its path for the `@path` mention. */
  uploadFile(file: PickedAttachment): Promise<string>;
  /** Whether dictation is on (`capabilities.voice` on a native host); asked on every state. */
  canVoice(): boolean;
  /** Sends one recorded clip (base64) to the Mac's Voice source and resolves with the text. Rejects with the sentence the page shows. */
  transcribe(audioBase64: string, mime: string): Promise<string>;
  /** Opens the app's system settings so a denied microphone can be allowed. */
  openMicrophoneSettings(): void;
  /** The agent's display name before any conversation states one (only the new-session draft has no frame). */
  provider?(): string | undefined;
}

export interface StreamInput {
  phase: 'connecting' | 'live' | 'reconnecting' | 'none' | 'gone';
  frame: ChatFrame | null;
  /** The pane's agent status from the tree: all that is known before a conversation exists. */
  fallbackStatus?: string;
  /** Overrides the page's no-conversation surface (a pending launch shows its echo or invite instead). */
  waiting?: boolean;
  /** The echo row stands but its delivery is no longer in progress (a failed start). */
  echoSettled?: boolean;
  /** One line above the composer (a failed start), overriding the queue view's line. */
  outcome?: string;
}

const NOT_YET = 'Not available.';

export interface ChatController {
  feed(input: StreamInput): void;
  /** Stands a prompt in as a user row for a launch the page did not send itself (the pending hand-off). */
  prime(text: string): void;
  state(): PageState;
  /** The page's `mygo.call(method, ...args)`. */
  call(method: string, args: readonly unknown[]): Promise<unknown>;
  dispose(): void;
}

export function createChatController(paneId: string, ops: ChatOps, onChange: (state: PageState) => void): ChatController {
  let input: StreamInput = { phase: 'connecting', frame: null };
  let echo = '';
  let echoTimer: ReturnType<typeof setTimeout> | undefined;
  let answeredId: string | null = null;
  // Queue: a follow-up just parked / just withdrawn, bridging the gap until the Host's next frame says so.
  let queuedLocal = '';
  let queueCancelled = false;
  let queuedOverride: PageInput['queuedOverride'];
  let seq = 0;
  let current: PageState;
  // The catalog is asked for once per screen (the Host caches the slow part); a failure is not remembered.
  let catalog: Promise<{ page: PageCatalog; verb: string }> | undefined;
  const loadCatalog = () => {
    catalog ??= ops.catalog().then(
      (c) => ({ page: toPageCatalog(c), verb: c.modelVerb ?? '' }),
      () => {
        catalog = undefined;
        return { page: EMPTY_CATALOG, verb: '' };
      },
    );
    return catalog;
  };

  const build = () => {
    seq += 1;
    current = toPageState({
      paneId,
      seq,
      frame: input.frame,
      fallbackStatus: input.fallbackStatus,
      provider: ops.provider?.(),
      echo,
      // A standing echo is the transcript until the stream confirms it: no connecting flash over the row,
      // and the `waiting` invite (a launch pending) wins over the connecting spinner.
      loading: input.phase === 'connecting' && echo === '' && input.waiting !== true,
      waiting: input.waiting,
      echoSettled: input.echoSettled,
      outcome: input.outcome,
      answeredId,
      queuedLocal,
      queueCancelled,
      queuedOverride,
      canReview: ops.canReview(),
      features: { ...PHONE_FEATURES, voice: ops.canVoice(), attach: ops.canAttach(), queue: ops.canQueue(), edit: ops.canQueue() && ops.canEdit(), reorder: ops.canQueue() && ops.canEdit() },
    });
    return current;
  };
  const emit = () => onChange(build());
  const enqueue = async (text: string): Promise<PageState> => {
    await ops.queue(text);
    queuedLocal = text;
    queueCancelled = false;
    return build();
  };
  // An edit/move the Host accepted, drawn at once; the next frame that differs from the one it was
  // made on carries the Host's own order and takes over.
  const bridgeQueue = (change: (items: NonNullable<PageState['queuedItems']>) => NonNullable<PageState['queuedItems']>): PageState => {
    const items = input.frame?.queued?.items;
    if (items) queuedOverride = { base: JSON.stringify(items), items: change(items) };
    return build();
  };
  const clearEcho = () => {
    echo = '';
    if (echoTimer) clearTimeout(echoTimer);
    echoTimer = undefined;
  };
  build();

  // A launch the screen handed over (Home/compose send): the row stands with no TTL — the stream's own
  // transcript ends it (`echoConfirmed`), or the screen settles it via `feed` after a failed start.
  const prime = (text: string) => {
    clearEcho();
    echo = text;
    emit();
  };
  const deliver = async (text: string, interrupt: boolean): Promise<PageState> => {
    await ops.send(text, interrupt);
    clearEcho();
    echo = text;
    echoTimer = setTimeout(() => {
      clearEcho();
      emit();
    }, ECHO_TTL_MS);
    return build();
  };
  const answer = async (request: ChatAnswerRequest): Promise<PageState> => {
    await ops.answer(request);
    answeredId = request.interactionId;
    return build();
  };
  const str = (value: unknown) => (typeof value === 'string' ? value : '');

  return {
    feed(next) {
      input = next;
      if (echo && echoConfirmed(next.frame, echo)) clearEcho();
      const id = next.frame?.interaction?.id;
      if (!id) answeredId = null; // a later identical re-ask must show again
      if (next.frame?.queued) queuedLocal = ''; // the Host carries it now
      else if (next.frame && queuedLocal && next.frame.agentStatus !== 'working') queuedLocal = ''; // delivered or gone
      if (!next.frame?.queued) queueCancelled = false;
      emit();
    },
    prime,
    state: () => current,
    async call(method, args) {
      switch (method) {
        case 'chat.CancelQueued':
          if (ops.canQueue()) {
            await ops.cancelQueued();
            queuedLocal = '';
            queueCancelled = true;
          }
          return build();
        case 'chat.CancelQueuedItem':
          if (ops.canQueue()) {
            await ops.cancelQueuedItem(str(args[0]));
            queuedLocal = '';
            queueCancelled = true;
          }
          return build();
        case 'chat.EditQueuedItem': {
          if (!ops.canQueue() || !ops.canEdit()) return build();
          const id = str(args[0]);
          const text = str(args[1]).trim();
          await ops.editQueuedItem(id, text);
          return bridgeQueue((items) => items.map((item) => (item.id === id ? { ...item, text } : item)));
        }
        case 'chat.ReorderQueued': {
          if (!ops.canQueue() || !ops.canEdit()) return build();
          const id = str(args[0]);
          const to = Number(args[1]);
          await ops.moveQueuedItem(id, to);
          return bridgeQueue((items) => {
            const at = items.findIndex((item) => item.id === id);
            if (at === -1) return items;
            const next = items.slice();
            const row = next.splice(at, 1)[0];
            if (!row) return items;
            next.splice(Math.min(Math.max(to, 0), next.length), 0, row);
            return next;
          });
        }
        case 'chat.Older':
          ops.older();
          return build();
        case 'chat.Snapshot':
        case 'chat.LinkSession':
          return build();
        case 'chat.Send':
          // A working agent takes the text through the Mac's queue (when it has one), a ready one now.
          if (current.disposition === 'queue' && ops.canQueue()) return enqueue(str(args[0]));
          return deliver(str(args[0]), false);
        case 'chat.InterruptAndSend':
          return deliver(str(args[0]), true);
        case 'chat.Stop':
          await ops.stop();
          return build();
        case 'chat.AnswerInteraction':
          return answer({ interactionId: str(args[0]), option: str(args[1]) });
        case 'chat.AnswerInteractionMulti':
          return answer({ interactionId: str(args[0]), options: Array.isArray(args[1]) ? args[1].map(str) : [] });
        case 'chat.AnswerInteractionText':
          return answer({ interactionId: str(args[0]), option: str(args[1]), text: str(args[2]) });
        case 'chat.OpenTerminal':
          ops.openTerminal();
          return undefined;
        case 'chat.Catalog':
          return (await loadCatalog()).page;
        case 'chat.SwitchModel': {
          const id = str(args[0]).trim();
          if (id === '' || /[\r\n]/.test(id)) throw new Error('Invalid model.');
          const { verb } = await loadCatalog();
          if (verb === '') throw new Error('This agent switches models through its own picker.');
          return deliver(`${verb}${id}`, false);
        }
        case 'chat.ListFiles':
          // A suggestion list, not an action: a Host that cannot answer just shows none.
          return ops.files(str(args[0])).catch(() => []);
        case 'chat.ContextUsage':
          return { used: current.contextTokens ?? 0, window: current.contextWindow ?? 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
        case 'chat.PickAttachment': {
          if (!ops.canAttach()) throw new Error(NOT_YET);
          const file = await ops.pickFile();
          return file ? ops.uploadFile(file) : '';
        }
        case 'chat.SaveAttachment':
          if (!ops.canAttach()) throw new Error(NOT_YET);
          return ops.uploadFile({ dataBase64: str(args[0]), mime: str(args[1]), name: str(args[2]) });
        case 'chat.ReviewChanges':
          if (ops.canReview()) ops.review(str(args[0]));
          return undefined;
        case 'chat.ShowContextMenu':
          return undefined;
        case 'chat.OpenMicrophoneSettings':
          ops.openMicrophoneSettings();
          return undefined;
        case 'chat.OpenSubagent':
          return ops.subagent(str(args[0]));
        case 'chat.Transcribe':
          if (!ops.canVoice()) throw new Error(NOT_YET);
          return ops.transcribe(str(args[0]), str(args[1]));
        default:
          throw new Error(`Unknown call ${method}`);
      }
    },
    dispose: clearEcho,
  };
}
