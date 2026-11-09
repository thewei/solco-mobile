import { describe, expect, it } from 'vitest';

import { HostV3Error } from '@/lib/host-client-v3';

import { refLabel, standingLabel, vaultFailureMessage, vaultNotice, vaultPhase, VAULT_NOTIFICATION_PREFIX } from './vault-model';

describe('vault model', () => {
  it('names the page state from the view', () => {
    expect(vaultPhase({ online: false, access: false, approvals: [] })).toBe('offline');
    expect(vaultPhase({ online: true, access: false, approvals: [] })).toBe('off');
    expect(vaultPhase({ online: true, access: true, state: 'locked', approvals: [] })).toBe('locked');
    expect(vaultPhase({ online: true, access: true, state: 'unlocked', approvals: [] })).toBe('ready');
  });

  it('words references and standings', () => {
    expect(refLabel('vault://agent/prod/pg#password')).toBe('agent/prod/pg · password');
    expect(refLabel('vault://env-item')).toBe('env-item');
    expect(standingLabel('new')).toBe('First use');
    expect(standingLabel('allowed')).toBe('Already allowed');
  });

  it('turns a Vault refusal into a sentence', () => {
    expect(vaultFailureMessage(new HostV3Error('http', 'x', { status: 410, code: 'vault_gone' }))).toContain('no longer waiting');
    expect(vaultFailureMessage(new HostV3Error('http', 'x', { status: 403, code: 'vault_reveal_off' }))).toContain('switched off');
    expect(vaultFailureMessage(new HostV3Error('transport', 'x'))).toContain('Could not reach');
    expect(vaultFailureMessage(new Error('boom'))).toContain('did not answer');
  });

  it('raises one notification per approval with the names the frame carried, and clears on resolve', () => {
    const show = vaultNotice({ t: 'vault', kind: 'approval', id: 7, waiting: 1, project: 'api', preview: 'agent/prod/pg#password' });
    expect(show).toMatchObject({ kind: 'show', request: { identifier: `${VAULT_NOTIFICATION_PREFIX}7`, title: 'api wants to use secrets', body: 'agent/prod/pg#password' } });
    expect(show.kind === 'show' && JSON.parse(String(show.request.data.route))).toEqual({ pathname: '/vault' });
    const get = vaultNotice({ t: 'vault', kind: 'approval', id: 8, waiting: 2, reveal: true });
    expect(get).toMatchObject({ kind: 'show', request: { title: 'A command wants to see a value', body: '2 requests are waiting.' } });
    expect(vaultNotice({ t: 'vault', kind: 'resolved', waiting: 0 })).toEqual({ kind: 'dismiss' });
    expect(vaultNotice({ t: 'vault', kind: 'approval', waiting: 1 })).toEqual({ kind: 'none' });
  });
});
