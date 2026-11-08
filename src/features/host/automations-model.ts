// [INPUT]: the Host's read-only Automations DTOs (AutomationItem / AutomationRun) and a clock.
// [OUTPUT]: automationAgentName, sortAutomations, stateLine (what the row says about the automation), runLine (the newest
//           run in words), nextLine, automationTone, automationsFailureMessage; the management side: CRON_PRESETS, AutomationForm
//           + emptyForm / formFromDetail / formProblem / fieldsOfForm, runRowLine, openablePane, automationActionMessage.
// [POS]: Pure presentation model behind the phone's Automations screens; no IO, no state. The Mac's plugin owns every fact —
//        what exists, when it runs, how the last run ended, whether a field is valid — this only words and orders them with
//        the desktop page's vocabulary (Failed / Finished / Running, Draft, Paused) and checks the few things a form must
//        have before a write is worth sending (name, schedule, repository, prompt). Error text of a run never reaches the
//        phone; a refusal of a write carries the plugin's own sentence, shown as it came.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import type { AutomationDetail, AutomationFields, AutomationItem, AutomationRunInfo, TreePane, TreeWorkspace } from '@/contracts/host-v3';
import { formatInMs } from '@/features/host/quota-model';
import { agoShort, flattenPanes } from '@/features/host/pane-model';
import { HostV3Error } from '@/lib/host-client-v3';

const AGENT_NAMES: Record<string, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  pi: 'Pi',
  omp: 'OMP',
  cursor: 'Cursor Agent',
  agy: 'Antigravity',
};

/** The plugin's agent kind in the product's own name; an unknown kind renders as itself. */
export function automationAgentName(kind: string | undefined): string {
  return kind ? (AGENT_NAMES[kind] ?? kind) : '';
}

export type AutomationTone = 'danger' | 'success' | 'accent' | 'attention' | 'muted';

/** One colour per row: a failure needs a look, a draft needs approval, a running one is live. */
export function automationTone(item: AutomationItem): AutomationTone {
  const status = item.lastRun?.status;
  if (item.state === 'draft') return 'attention';
  if (status === 'failed') return 'danger';
  if (status === 'running') return 'accent';
  if (item.unread) return 'success';
  return 'muted';
}

const RANK: Record<AutomationTone, number> = { danger: 0, attention: 1, accent: 2, success: 3, muted: 4 };

/** Needs-you first (failed, drafts), then running, then unread results, then the rest; stable by name inside a rank. */
export function sortAutomations(items: readonly AutomationItem[]): AutomationItem[] {
  return [...items].sort((a, b) => RANK[automationTone(a)] - RANK[automationTone(b)] || a.name.localeCompare(b.name));
}

/** "Failed 3h ago · 31s" / "Running" / "Never run". */
export function runLine(item: AutomationItem, now: number): string {
  const run = item.lastRun;
  if (!run) return item.state === 'draft' ? 'Not scheduled until approved' : 'Never run';
  const word =
    run.status === 'done' ? 'Finished' : run.status === 'failed' ? 'Failed' : run.status === 'running' ? 'Running' : run.status.charAt(0).toUpperCase() + run.status.slice(1);
  if (run.status === 'running') return word;
  const ago = run.atMs ? `${agoShort(run.atMs, now)} ago` : '';
  const took = run.durationSec ? `${run.durationSec < 90 ? `${run.durationSec}s` : formatInMs(run.durationSec * 1000)}` : '';
  return [`${word}${ago ? ` ${ago}` : ''}`, took].filter(Boolean).join(' · ');
}

/** "Next in 4h 20m" for an active automation; nothing for a draft or a paused one. */
export function nextLine(item: AutomationItem, now: number): string | null {
  if (item.state !== 'active' || !item.nextRunMs) return null;
  return `Next in ${formatInMs(item.nextRunMs - now)}`;
}

/** The row's caption: schedule · agent (· headless). */
export function stateLine(item: AutomationItem): string {
  const state = item.state === 'draft' ? 'Draft' : item.state === 'paused' ? 'Paused' : '';
  return [state, item.schedule, automationAgentName(item.agent), item.headless ? 'Headless' : '']
    .filter((part): part is string => Boolean(part))
    .join(' · ');
}

/** One line per failure of the list read. */
export function automationsFailureMessage(error: unknown): string {
  if (error instanceof HostV3Error) {
    if (error.code === 'automations_unavailable') return 'Automations are not enabled on your computer.';
    if (error.kind === 'transport') return 'Could not reach the computer. Pull to try again.';
  }
  return 'The computer did not answer. Pull to try again.';
}

// ---- Management: the New / Edit form, run rows and the words of a refusal ----

/** The desktop form's schedule presets; an empty cron is the "Custom…" entry (the user types the five fields). */
export const CRON_PRESETS: readonly { label: string; cron: string }[] = [
  { label: 'Daily 09:00', cron: '0 9 * * *' },
  { label: 'Weekdays 09:00', cron: '0 9 * * 1-5' },
  { label: 'Hourly', cron: '0 * * * *' },
  { label: 'Mondays 09:00', cron: '0 9 * * 1' },
  { label: 'Custom…', cron: '' },
];

/** The form as typed: strings for everything a person edits, the plugin judges the values. */
export interface AutomationForm {
  name: string;
  cron: string;
  repo: string;
  /** worktree | root */
  workspace: string;
  /** The plugin's agent kind (claude, codex …); empty until picked. */
  agent: string;
  model: string;
  prompt: string;
  rationale: string;
  /** skip | queue */
  onOverlap: string;
  headless: boolean;
  timeoutMinutes: string;
  catchUpMinutes: string;
  cleanupTtlHours: string;
}

export function emptyForm(agent = ''): AutomationForm {
  return {
    name: '',
    cron: '',
    repo: '',
    workspace: 'worktree',
    agent,
    model: '',
    prompt: '',
    rationale: '',
    onOverlap: 'skip',
    headless: false,
    timeoutMinutes: '',
    catchUpMinutes: '',
    cleanupTtlHours: '',
  };
}

const minutes = (n: number | undefined) => (n ? String(n) : '');

export function formFromDetail(detail: AutomationDetail): AutomationForm {
  return {
    name: detail.name,
    cron: detail.cron ?? '',
    repo: detail.repo ?? '',
    workspace: detail.workspace || 'worktree',
    agent: detail.agent ?? '',
    model: detail.model ?? '',
    prompt: detail.prompt ?? '',
    rationale: detail.rationale ?? '',
    onOverlap: detail.onOverlap || 'skip',
    headless: detail.headless === true,
    timeoutMinutes: minutes(detail.timeoutMinutes),
    catchUpMinutes: minutes(detail.catchUpMinutes),
    cleanupTtlHours: minutes(detail.cleanupTtlHours),
  };
}

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Why the form cannot be sent yet, or null. Only presence and shape; the plugin judges cron and the repository. */
export function formProblem(form: AutomationForm, isNew: boolean): string | null {
  if (isNew) {
    const name = form.name.trim();
    if (!name) return 'Give it a name.';
    if (name.length > 80 || !NAME_RE.test(name)) return 'Use letters, digits, dot, dash or underscore in the name.';
  }
  if (!form.cron.trim()) return 'Pick a schedule.';
  if (!form.repo.trim()) return 'Choose a repository.';
  if (!form.agent) return 'Pick an agent.';
  if (!form.prompt.trim()) return 'Write the prompt.';
  for (const [label, value] of [
    ['Timeout', form.timeoutMinutes],
    ['Catch-up', form.catchUpMinutes],
    ['Cleanup', form.cleanupTtlHours],
  ] as const) {
    if (value.trim() && !/^\d{1,5}$/.test(value.trim())) return `${label} must be a whole number.`;
  }
  return null;
}

const whole = (value: string): number | undefined => (/^\d+$/.test(value.trim()) && Number(value) > 0 ? Number(value) : undefined);

/** The write body's fields; empty text and zero stay off the wire. */
export function fieldsOfForm(form: AutomationForm): AutomationFields {
  const text = (value: string) => (value.trim() ? value.trim() : undefined);
  return {
    cron: text(form.cron),
    repo: text(form.repo),
    workspace: form.workspace,
    agent: form.agent || undefined,
    model: text(form.model),
    prompt: form.prompt.trim() ? form.prompt : undefined,
    rationale: form.rationale.trim() ? form.rationale : undefined,
    onOverlap: form.onOverlap,
    headless: form.headless || undefined,
    timeoutMinutes: whole(form.timeoutMinutes),
    catchUpMinutes: whole(form.catchUpMinutes),
    cleanupTtlHours: whole(form.cleanupTtlHours),
  };
}

const RUN_STATUS: Record<string, string> = { done: 'Finished', failed: 'Failed', running: 'Running' };
const TRIGGERS: Record<string, string> = { schedule: 'Scheduled', manual: 'Run now', catchup: 'Catch-up' };

/** "Failed · Scheduled · 3h ago · 31s" for one history row. */
export function runRowLine(run: AutomationRunInfo, now: number): string {
  const status = RUN_STATUS[run.status] ?? run.status.charAt(0).toUpperCase() + run.status.slice(1);
  const trigger = run.trigger ? (TRIGGERS[run.trigger] ?? run.trigger) : '';
  const ago = run.atMs ? `${agoShort(run.atMs, now)} ago` : '';
  const took = run.status !== 'running' && run.durationSec ? (run.durationSec < 90 ? `${run.durationSec}s` : formatInMs(run.durationSec * 1000)) : '';
  return [status, trigger, ago, took].filter(Boolean).join(' · ');
}

/** The pane a run left behind, when this phone's tree still lists it (a cleaned-up worktree's pane is gone). */
export function openablePane(run: AutomationRunInfo, workspaces: readonly TreeWorkspace[]): TreePane | null {
  if (!run.paneId) return null;
  return flattenPanes(workspaces).find((entry) => entry.pane.paneId === run.paneId)?.pane ?? null;
}

/** One sentence for a failed write: the plugin's own words for a refusal, ours for the rest. */
export function automationActionMessage(error: unknown): string {
  if (error instanceof HostV3Error) {
    if (error.code === 'automation_refused' && error.message) return error.message;
    if (error.code === 'unknown_automation') return 'That automation no longer exists.';
    if (error.code === 'automation_unavailable' || error.code === 'automations_unavailable') return 'Automations are not enabled on your computer.';
    if (error.code === 'automation_failed') return 'The plugin on your computer did not complete that. Try again.';
    if (error.kind === 'transport') return 'Could not reach the computer. Try again.';
    if (error.status === 403) return 'This phone is not allowed to change automations.';
  }
  return 'The computer did not answer. Try again.';
}
