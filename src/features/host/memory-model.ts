// [INPUT]: the two memory notes and the proactivity wire types (contracts/host-v3) as the Mac's core reports them.
// [OUTPUT]: noteSync, PROACTIVITY_CHOICES, draftOf, inputOf, isDirty, quietLine.
// [POS]: Pure rules for the phone's Memory and Behavior screens. The core owns every fact (the notes' text and rev, what the
//        rules are); this only decides what an open editor does when the Mac's note moves, and checks a form before it is sent —
//        the core re-checks everything and its refusal is shown as it is.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import type { NoteFile, Proactivity, ProactivityInput } from '@/contracts/host-v3';

/** An open note editor: the version it started from and what the person has typed since. */
export interface NoteDraft {
  base: NoteFile;
  text: string;
}

/**
 * What an editor does when the Mac's note is `current`. A newer version is adopted when there is nothing typed to lose (or
 * what was typed already is the new text); otherwise the editor is in conflict — saving names the old rev and would be refused,
 * so the person chooses to reload (their edit is dropped) rather than anything being merged.
 */
export function noteSync(draft: NoteDraft, current: NoteFile): { dirty: boolean; adopt: boolean; conflict: boolean } {
  const dirty = draft.text !== draft.base.text;
  const moved = current.rev !== draft.base.rev;
  const adopt = moved && (!dirty || draft.text === current.text);
  return { dirty, adopt, conflict: moved && !adopt };
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
