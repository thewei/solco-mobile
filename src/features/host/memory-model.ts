// [INPUT]: the memory review and proactivity wire types (contracts/host-v3) as the Mac's core reports them.
// [OUTPUT]: memoryAuthor, memoryNote, splitMemory, PROACTIVITY_CHOICES, draftOf, inputOf, isDirty, quietLine.
// [POS]: Pure wording and validation for the phone's Memory and Behavior screens. The core owns every fact (which items are
//        duplicates, which edits collided, what the rules are); this only words them and checks a form before it is sent —
//        the core re-checks everything and its refusal is shown as it is.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import type { AssistantMemory, MemoryReview, Proactivity, ProactivityInput } from '@/contracts/host-v3';

const AUTHORS: Record<string, string> = { user: 'You', agent: 'Assistant', files: 'Folder edit', system: 'Before history' };

export function memoryAuthor(author: string): string {
  return AUTHORS[author] ?? author;
}

/** One quiet word about an item the core flagged; empty when it flagged nothing. */
export function memoryNote(review: MemoryReview, item: AssistantMemory): string {
  if (item.kind === 'conflict') return 'Edit conflict';
  if (review.staleCandidates.includes(item.id)) return 'Waiting a while';
  if (review.duplicates.some((group) => group.includes(item.id))) return 'Looks like a duplicate';
  return '';
}

export function splitMemory(review: MemoryReview): { candidates: AssistantMemory[]; approved: AssistantMemory[] } {
  return {
    candidates: review.items.filter((m) => m.state === 'candidate'),
    approved: review.items.filter((m) => m.state === 'approved'),
  };
}

export const PROACTIVITY_CHOICES: { id: string; title: string; hint: string }[] = [
  { id: 'respond', title: 'Only when I ask', hint: 'Starts nothing on its own and sends no reminders.' },
  { id: 'suggest', title: 'Suggest', hint: 'Says what it would do next and when a Goal stalls, but starts nothing.' },
  { id: 'follow_up', title: 'Follow up', hint: 'Carries your approved Goals forward and reminds you, within the limits below.' },
];

export interface ProactivityDraft {
  level: string;
  quiet: boolean;
  start: string;
  end: string;
  every: string;
  budget: string;
}

export function draftOf(p: Proactivity): ProactivityDraft {
  return { level: p.level, quiet: p.quietStart !== '', start: p.quietStart || '22:00', end: p.quietEnd || '08:00', every: String(p.reportEveryMin), budget: String(p.dailyBudget) };
}

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The form as a write, or the one thing wrong with it. `zone` is the phone's own time zone, used when quiet hours are first set. */
export function inputOf(draft: ProactivityDraft, p: Proactivity, zone: string): { ok: true; input: ProactivityInput } | { ok: false; error: string } {
  if (draft.quiet && !(CLOCK.test(draft.start) && CLOCK.test(draft.end))) return { ok: false, error: 'Quiet hours are times like 22:00 and 08:00.' };
  const every = Number(draft.every);
  if (!Number.isInteger(every) || every < 0 || every > 1440) return { ok: false, error: 'Reminder spacing is 0 to 1440 minutes.' };
  const budget = Number(draft.budget);
  if (!Number.isInteger(budget) || budget < 1 || budget > 100) return { ok: false, error: 'The daily budget is 1 to 100 tasks.' };
  return {
    ok: true,
    input: {
      level: draft.level,
      quietStart: draft.quiet ? draft.start : '',
      quietEnd: draft.quiet ? draft.end : '',
      tz: draft.quiet ? p.tz || zone : '',
      reportEveryMin: every,
      dailyBudget: budget,
    },
  };
}

export function isDirty(input: ProactivityInput, p: Proactivity): boolean {
  return input.level !== p.level || input.quietStart !== p.quietStart || input.quietEnd !== p.quietEnd || input.reportEveryMin !== p.reportEveryMin || input.dailyBudget !== p.dailyBudget;
}

export function quietLine(p: Proactivity): string {
  if (p.quietStart === '') return 'No quiet hours';
  return `Quiet ${p.quietStart}–${p.quietEnd}${p.tz ? ` (${p.tz})` : ''}${p.quietNow ? ' · quiet now' : ''}`;
}
