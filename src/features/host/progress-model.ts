// [INPUT]: a Goal plan, its milestones and the core's fact ledger (Host `personalAgentPlans`).
// [OUTPUT]: factLabel/factTone/milestoneLabel/milestoneTone/planLine — the phone's words for what the Mac's core derived.
// [POS]: Pure presentation of the Assistants U3 surface. Nothing here decides progress: a milestone is verified only because the
//        core said so from the real task, and a fact is a sentence the core wrote — the screen labels the ledger "Solco", never
//        as the Assistant speaking.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import type { Fact, GoalPlan, MilestoneView, Routine } from '@/contracts/host-v3';

export type Tone = 'ok' | 'warn' | 'bad' | 'work' | 'muted';

const FACT_LABEL: Record<string, string> = {
  accepted: 'Accepted',
  planned: 'Planned',
  replanned: 'Re-planned',
  delegated: 'Delegated',
  verifying: 'Verifying',
  verified: 'Verified',
  blocked: 'Blocked',
  ready: 'Needs you',
  done: 'Done',
  stale: 'No progress',
  held: 'Held',
  routine: 'Routine',
  routine_done: 'Routine ran',
  routine_failed: 'Routine failed',
};
const FACT_TONE: Record<string, Tone> = { verified: 'ok', done: 'ok', blocked: 'bad', held: 'bad', stale: 'warn', ready: 'warn', verifying: 'work', delegated: 'work', routine_done: 'ok', routine_failed: 'bad' };

export const factLabel = (f: Pick<Fact, 'kind'>): string => FACT_LABEL[f.kind] ?? f.kind;
export const factTone = (f: Pick<Fact, 'kind'>): Tone => FACT_TONE[f.kind] ?? 'muted';

const MS_LABEL: Record<MilestoneView['state'], string> = { pending: 'Waiting', working: 'Working', verifying: 'In review', verified: 'Verified', blocked: 'Blocked', needs_you: 'Needs you' };
const MS_TONE: Record<MilestoneView['state'], Tone> = { pending: 'muted', working: 'work', verifying: 'work', verified: 'ok', blocked: 'bad', needs_you: 'warn' };

export const milestoneLabel = (m: Pick<MilestoneView, 'state'>): string => MS_LABEL[m.state];
export const milestoneTone = (m: Pick<MilestoneView, 'state'>): Tone => MS_TONE[m.state];

/** `1 of 3 milestones verified · working · revised 2×` — no percentage: only counts the core can prove. */
export function planLine(plan: Pick<GoalPlan, 'total' | 'verified' | 'state' | 'replans'>): string {
  const counted = plan.total === 0 ? 'No milestones' : `${plan.verified} of ${plan.total} milestone${plan.total === 1 ? '' : 's'} verified`;
  const parts = [counted, plan.state.replace('_', ' ')];
  if (plan.replans > 0) parts.push(`revised ${plan.replans}×`);
  return parts.join(' · ');
}

const ROUTINE_LABEL: Record<string, string> = { draft: 'Waiting for you', active: 'On', stale: 'Changed — ask again', cancelled: 'Withdrawn' };
const ROUTINE_TONE: Record<string, Tone> = { draft: 'warn', active: 'ok', stale: 'warn', cancelled: 'muted' };

export const routineLabel = (r: Pick<Routine, 'state' | 'paused'>): string => (r.paused ? 'Paused' : (ROUTINE_LABEL[r.state] ?? r.state));
export const routineTone = (r: Pick<Routine, 'state' | 'paused'>): Tone => (r.paused ? 'warn' : (ROUTINE_TONE[r.state] ?? 'muted'));

/** `0 9 * * * · claude · headless` — what runs and how, without the folder (the card shows it separately). */
export const routineLine = (r: Pick<Routine, 'cron' | 'agent' | 'headless'>): string => [r.cron, r.agent, r.headless ? 'headless' : ''].filter(Boolean).join(' · ');
