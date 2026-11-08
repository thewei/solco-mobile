// [INPUT]: the Group wire types (contracts/host-v3) — members, messages, deliveries, task cards, per-Assistant Agent states.
// [OUTPUT]: avatarTone/avatarInitial (the desktop's own palette), resolveMentions/mentionsIn (exact `@Name` tokens + the picker's picks → member ids; equal names never guessed), mentionQuery/applyMention
//           (the composer's @ picker), splitMentions (a body as text and chip parts), factLine (a core receipt in words),
//           deliveryMark, taskStateLabel, agentNotes (what the status line says about starting/blocked Agents), chatRows.
// [POS]: Pure presentation model behind the phone's Group chat. The Mac's Go core owns every fact — who spoke, who was woken,
//        what a delivery did, which Agent is alive; this only words them with the desktop page's vocabulary. A fact row is a
//        receipt the core wrote, never a member's speech, and nothing here can make an Assistant talk.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import type { GroupAgentState, GroupDelivery, GroupFeed, GroupMember, GroupMessage, GroupTaskCard } from '@/contracts/host-v3';

const TONES = ['#0a84ff', '#30d158', '#ff9f0a', '#ff453a', '#ff375f', '#bf5af2', '#40c8e0', '#5e5ce6'] as const;

/** fnv32a over the stable id — the same palette index the desktop's Go avatar and group page use. */
export function avatarTone(id: string): string {
  let h = 0x811c9dc5;
  for (const b of new TextEncoder().encode(id)) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return TONES[h % TONES.length] ?? TONES[0];
}

export function avatarInitial(name: string): string {
  const t = name.trim();
  const m = t.match(/[\p{L}\p{N}]/u);
  if (m) return m[0].toUpperCase();
  return [...t].find((c) => c.trim() !== '') ?? '?';
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const byNameLength = (members: readonly GroupMember[]) => [...members].sort((a, b) => b.name.length - a.name.length);

const isAscii = (c: string) => /^[A-Za-z0-9_]$/.test(c);

/**
 * The member names standing as `@Name` tokens, in order. Mirrors the core's token rule (`checkMentions`): each `@` belongs to
 * the longest member name after it, an ASCII-word name must end where the word ends (`@Bobby` never reads as `@Bo`), a CJK name
 * needs no space, and an `@` glued to a word (`bo@example.com`) is no mention.
 */
export function mentionNames(text: string, members: readonly GroupMember[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== '@') continue;
    const before = text[i - 1];
    if (before !== undefined && (isAscii(before) || before === '@')) continue;
    const rest = text.slice(i + 1);
    let best = '';
    for (const m of members) {
      if (!m.name || !rest.startsWith(m.name) || m.name.length <= best.length) continue;
      const last = m.name[m.name.length - 1] ?? '';
      const next = rest[m.name.length];
      if (isAscii(last) && next !== undefined && isAscii(next)) continue;
      best = m.name;
    }
    if (best) {
      out.push(best);
      i += best.length;
    }
  }
  return out;
}

export interface ResolvedMentions {
  ids: string[];
  /** Names that stand for more than one member and were not told apart by a pick. */
  ambiguous: string[];
}

/**
 * The member ids a message wakes. `picks` are the members chosen from the picker (in order): they alone decide between members
 * that share a name, so one `@Ada` token wakes at most one of two Adas and typed text never silently picks one.
 */
export function resolveMentions(text: string, members: readonly GroupMember[], picks: readonly GroupMember[] = []): ResolvedMentions {
  const ids: string[] = [];
  const ambiguous: string[] = [];
  const taken = new Set<string>();
  const left = [...picks];
  for (const name of mentionNames(text, members)) {
    const same = members.filter((m) => m.name === name);
    let chosen: GroupMember | undefined;
    if (same.length === 1) chosen = same[0];
    else {
      const at = left.findIndex((p) => p.name === name && !taken.has(p.assistantId));
      if (at >= 0) chosen = left.splice(at, 1)[0];
    }
    if (!chosen) {
      if (!ambiguous.includes(name)) ambiguous.push(name);
      continue;
    }
    if (!taken.has(chosen.assistantId)) {
      taken.add(chosen.assistantId);
      ids.push(chosen.assistantId);
    }
  }
  return { ids, ambiguous };
}

/** The member ids of the names that point at exactly one member (what the picker hides as already mentioned). */
export function mentionsIn(text: string, members: readonly GroupMember[]): string[] {
  return resolveMentions(text, members).ids;
}

export interface BodyPart {
  text: string;
  mention: boolean;
}

/** The body as plain parts and mention chips. */
export function splitMentions(text: string, members: readonly GroupMember[]): BodyPart[] {
  if (members.length === 0) return [{ text, mention: false }];
  const names = byNameLength(members).map((m) => escapeRe(m.name));
  const re = new RegExp(`(@(?:${names.join('|')})(?![\\p{L}\\p{N}_]))`, 'gu');
  return text
    .split(re)
    .map((part, i) => ({ text: part, mention: i % 2 === 1 }))
    .filter((part) => part.text !== '');
}

/** The `@` token the caret sits in (draft start or after whitespace), or null — what the picker filters by. */
export function mentionQuery(text: string): string | null {
  const m = text.match(/(?:^|\s)@([^\s@]*)$/u);
  return m ? (m[1] ?? '') : null;
}

/** Members the picker offers for a query (prefix match first, then contains), never the ones already mentioned. */
export function mentionChoices(text: string, members: readonly GroupMember[]): GroupMember[] {
  const query = mentionQuery(text);
  if (query === null) return [];
  const q = query.toLowerCase();
  const taken = new Set(mentionsIn(text.replace(/@[^\s@]*$/u, ''), members));
  const live = members.filter((m) => m.status === 'active' && !taken.has(m.assistantId));
  return [...live.filter((m) => m.name.toLowerCase().startsWith(q)), ...live.filter((m) => !m.name.toLowerCase().startsWith(q) && m.name.toLowerCase().includes(q))];
}

/** Replaces the trailing `@query` with `@Name ` . */
export function applyMention(text: string, member: GroupMember): string {
  return text.replace(/(^|\s)@[^\s@]*$/u, (_m, lead: string) => `${lead}@${member.name} `);
}

/** One core receipt in words; null for the ones the delivery chip already says. */
export function factLine(fact: GroupMessage['fact'], nameOf: (id: string) => string): string | null {
  if (!fact) return null;
  const who = fact.name || nameOf(fact.assistantId ?? '');
  switch (fact.event) {
    case 'agent_starting':
      return `${who} is starting…`;
    case 'delivery_failed':
      return `Couldn’t reach ${who}. @ ${who} again to retry.`;
    case 'delivery_uncertain':
      return `${who} may not have received that. @ ${who} again to retry.`;
    case 'delivery_skipped':
      return `${who} was not reached (no longer in the group).`;
    case 'assistant_disabled':
      return `${who} is paused and was not asked.`;
    case 'agent_blocked':
      return fact.reason ? `${who} is waiting for you in its terminal: ${fact.reason}` : `${who} is waiting for you in its terminal.`;
    case 'agent_failed':
      return `${who}’s agent stopped. @ ${who} again to start it.`;
    case 'member_added':
      return `${who} joined`;
    case 'member_removed':
      return `${who} left`;
  }
  return null;
}

/** The small mark under a message the person sent, per woken Assistant. */
export function deliveryMark(state: string): string {
  switch (state) {
    case 'delivered':
      return '✓';
    case 'failed':
      return '✕';
    case 'uncertain':
      return '?';
    case 'skipped':
      return '–';
  }
  return '…';
}

const TASK_STATE: Record<string, string> = {
  draft: 'Draft',
  waiting: 'Waiting',
  queued: 'Queued',
  claimed: 'Starting',
  starting: 'Starting',
  running: 'Working',
  blocked: 'Blocked',
  review_required: 'Needs review',
  done: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export function taskStateLabel(state: string): string {
  return TASK_STATE[state] ?? state;
}

export interface AgentNote {
  assistantId: string;
  kind: 'starting' | 'blocked';
  /** The pane the person can open to answer a dialog (blocked only). */
  paneId?: string;
}

/** Agents that are coming up or waiting on a dialog right now — what the status line above the composer says. */
export function agentNotes(agents: readonly GroupAgentState[]): AgentNote[] {
  const out: AgentNote[] = [];
  for (const a of agents) {
    if (a.state === 'starting') out.push({ assistantId: a.assistantId, kind: 'starting' });
    else if (a.state === 'blocked') out.push({ assistantId: a.assistantId, kind: 'blocked', paneId: a.paneId });
  }
  return out;
}

export interface ChatRow {
  message: GroupMessage;
  /** Same author as the row above within a minute: the avatar and name are drawn once. */
  continued: boolean;
  deliveries: GroupDelivery[];
  task?: GroupTaskCard;
  quoted?: GroupMessage;
}

/** The feed as rows: facts the delivery chip already says are dropped, a task row carries its live card, a reply its quote. */
export function chatRows(feed: Pick<GroupFeed, 'messages' | 'deliveries' | 'tasks' | 'group'>): ChatRow[] {
  const nameOf = (id: string) => feed.group.members.find((m) => m.assistantId === id)?.name ?? '';
  const byId = new Map(feed.messages.map((m) => [m.id, m]));
  const tasks = new Map(feed.tasks.map((t) => [t.taskId, t]));
  const rows: ChatRow[] = [];
  let previous: GroupMessage | undefined;
  for (const message of feed.messages) {
    if (message.kind === 'fact' && factLine(message.fact, nameOf) === null) continue;
    const speech = message.kind !== 'fact';
    const continued =
      speech &&
      previous !== undefined &&
      previous.kind !== 'fact' &&
      previous.authorKind === message.authorKind &&
      (previous.authorId ?? '') === (message.authorId ?? '') &&
      message.createdAt - previous.createdAt < 60_000 &&
      message.replyTo === undefined;
    rows.push({
      message,
      continued,
      deliveries: feed.deliveries.filter((d) => d.messageId === message.id),
      task: message.taskId ? tasks.get(message.taskId) : undefined,
      quoted: message.replyTo ? byId.get(message.replyTo) : undefined,
    });
    previous = message;
  }
  return rows;
}
