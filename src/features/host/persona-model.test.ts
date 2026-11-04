import { describe, expect, it } from 'vitest';

import type { Instructions, McpServerState } from '@/contracts/host-v3';
import { HostV3Error } from '@/lib/host-client-v3';

import { behindSurfaces, personaMessage, serverChips, surfaceLabel, takesEffort } from './persona-model';

const server = (over: Partial<McpServerState>): McpServerState => ({
  id: 'alpha',
  name: 'alpha',
  transport: 'stdio',
  summary: 'alpha-mcp',
  sources: ['claude'],
  agents: ['claude'],
  configured: true,
  granted: true,
  bound: [],
  verified: '',
  verifiedAt: 0,
  ...over,
});

describe('persona model', () => {
  it('words surfaces', () => {
    expect(surfaceLabel('coordinator')).toBe('Conversation');
    expect(surfaceLabel('group:g_1')).toBe('Group agent');
    expect(surfaceLabel('task')).toBe('Task agent');
  });

  it('lists the surfaces still on an older instructions revision', () => {
    const ins = { assistantId: 'a_1', revision: 3, body: '', history: [], applied: [{ surface: 'coordinator', revision: 2, appliedAt: 1 }, { surface: 'task', revision: 3, appliedAt: 1 }] } as Instructions;
    expect(behindSurfaces(ins)).toEqual([{ surface: 'coordinator', revision: 2 }]);
  });

  it('only Claude (or the default) takes an effort', () => {
    expect(takesEffort('')).toBe(true);
    expect(takesEffort('claude')).toBe(true);
    expect(takesEffort('codex')).toBe(false);
  });

  it('never calls a granted or bound server connected', () => {
    expect(serverChips(server({ granted: true, bound: ['coordinator'] })).map((c) => c.text)).toEqual(['handed to Conversation']);
    expect(serverChips(server({ verified: 'connected' }))).toEqual([{ text: 'connected', tone: 'ok' }]);
    expect(serverChips(server({ verified: 'failed' }))).toEqual([{ text: 'failed', tone: 'bad' }]);
    expect(serverChips(server({ configured: false })).map((c) => c.text)).toEqual(['not in your config']);
    expect(serverChips(server({ agents: ['codex'] })).map((c) => c.text)).toEqual(['Codex only']);
  });

  it('words the check refusals and falls back to the Assistants wording', () => {
    expect(personaMessage(new HostV3Error('http', 'Not for this Agent', { status: 409, code: 'mcp_unsupported' }))).toBe('Not for this Agent');
    expect(personaMessage(new HostV3Error('http', '', { status: 409, code: 'stale_revision' }))).toContain('changed on your computer');
  });
});
