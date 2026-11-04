// [INPUT]: the tree's summarize() result (or nothing before the first tree), whether the Mac answers,
//          and the Mac's name.
// [OUTPUT]: keepAliveStatus — the title and the one status line of the Android ongoing notification.
// [POS]: Pure wording of the keep-alive notification (features/host/background-bridge pushes it
//        through lib/foreground-service). Same three groups as Home and the widget: Needs you /
//        Working / Idle. No IO.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import type { KeepAliveStatus } from '@/lib/foreground-service';

export interface AgentCounts {
  needsYou: number;
  working: number;
  idle: number;
}

/** `Needs you: 10 · Working: 4 · Idle: 2`; a quiet sentence when there is nothing to count. */
export function keepAliveStatus(input: { name?: string; counts: AgentCounts | null; reachable: boolean }): KeepAliveStatus {
  const title = input.name?.trim() ? `Solco · ${input.name.trim()}` : 'Solco';
  if (!input.reachable) return { title, text: 'Can’t reach your Mac — retrying' };
  const { counts } = input;
  if (!counts) return { title, text: 'Staying connected to your Mac' };
  if (counts.needsYou + counts.working + counts.idle === 0) return { title, text: 'No agents running' };
  return { title, text: `Needs you: ${counts.needsYou} · Working: ${counts.working} · Idle: ${counts.idle}` };
}
