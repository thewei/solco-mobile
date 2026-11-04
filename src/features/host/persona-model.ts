// [INPUT]: the persona wire types (contracts/host-v3) as the Mac's core reports them.
// [OUTPUT]: surfaceLabel, behindSurfaces, takesEffort, serverChips, personaMessage.
// [POS]: Pure wording for the phone's Work style screen. The core owns every fact (which revision an Agent started with, which MCP
//        servers are granted/bound/verified); this only words them and never infers one — "connected" is shown only when the Agent
//        itself said so in a check, never because a server is granted or bound.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import type { Instructions, McpServerState } from '@/contracts/host-v3';
import { personalAgentMessage } from '@/features/host/personal-agent-model';
import { HostV3Error } from '@/lib/host-client-v3';

export function surfaceLabel(surface: string): string {
  if (surface === 'coordinator') return 'Conversation';
  if (surface.startsWith('group:')) return 'Group agent';
  if (surface === 'task') return 'Task agent';
  return surface;
}

/** Surfaces still running an older instructions revision than the current one (they pick the new text up when restarted). */
export function behindSurfaces(ins: Instructions): { surface: string; revision: number }[] {
  return ins.applied.filter((a) => a.revision < ins.revision).map((a) => ({ surface: a.surface, revision: a.revision }));
}

/** Mirrors the core's table of Agents whose launch takes a thinking effort (the core ignores it for any other). */
export function takesEffort(agent: string): boolean {
  return agent === '' || agent === 'claude';
}

export type Chip = { text: string; tone: 'ok' | 'warn' | 'bad' | 'muted' };

/** The four MCP facts of one server, kept apart. */
export function serverChips(s: McpServerState): Chip[] {
  const chips: Chip[] = [];
  if (!s.configured) chips.push({ text: 'not in your config', tone: 'bad' });
  if (!s.agents.includes('claude') && s.configured) chips.push({ text: 'Codex only', tone: 'muted' });
  if (s.bound.length > 0) chips.push({ text: `handed to ${s.bound.map(surfaceLabel).join(', ')}`, tone: 'muted' });
  if (s.verified) chips.push({ text: s.verified === 'connected' ? 'connected' : s.verified, tone: s.verified === 'connected' ? 'ok' : 'bad' });
  return chips;
}

export function personaMessage(error: unknown): string {
  if (error instanceof HostV3Error) {
    if (error.code === 'mcp_unsupported') return error.message || 'This Agent cannot be checked.';
    if (error.code === 'mcp_probe_failed') return error.message ? `The check did not complete: ${error.message}` : 'The check did not complete.';
  }
  return personalAgentMessage(error);
}
