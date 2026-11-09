// [INPUT]: the Host's Vault view (GET /vault), a `vault` events frame, a failure from a Vault route.
// [OUTPUT]: vaultPhase(view) (offline | off | locked | ready), refLabel, standingLabel, vaultFailureMessage(error),
//           vaultNotice(frame) → show | dismiss, VAULT_NOTIFICATION_PREFIX, REVEAL_HIDE_MS.
// [POS]: Pure wording behind the phone's Vault page (2026-11-09: approve, browse, show a value). Solco Vault on the Mac owns
//        every state and both switches; this only words them. A notification carries the project and the reference names
//        the frame carried (never a value); one identifier per approval, so answering anywhere clears it. Pure, tested.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import type { EventMessage, VaultView } from '@/contracts/host-v3';
import type { NotificationRequest } from '@/features/host/attention-delivery';
import { HostV3Error } from '@/lib/host-client-v3';

export type VaultFrame = Extract<EventMessage, { t: 'vault' }>;

export const VAULT_NOTIFICATION_PREFIX = 'solco-vault/';

/** A value shown on the phone hides itself after this long. */
export const REVEAL_HIDE_MS = 30_000;

export type VaultPhase = 'offline' | 'off' | 'locked' | 'ready';

export function vaultPhase(view: VaultView): VaultPhase {
  if (!view.online) return 'offline';
  if (!view.access) return 'off';
  return view.state === 'unlocked' ? 'ready' : 'locked';
}

/** `vault://agent/prod/pg#password` → `agent/prod/pg · password`. */
export function refLabel(ref: string): string {
  const [path, field] = ref.replace(/^vault:\/\//, '').split('#');
  return field ? `${path} · ${field}` : (path ?? ref);
}

export function standingLabel(standing: 'new' | 'ask' | 'allowed'): string {
  return standing === 'new' ? 'First use' : standing === 'ask' ? 'Asks every time' : 'Already allowed';
}

export function vaultFailureMessage(error: unknown): string {
  if (error instanceof HostV3Error) {
    switch (error.code) {
      case 'vault_gone':
        return 'That request is no longer waiting — it was answered on the Mac or timed out.';
      case 'vault_offline':
        return 'Solco Vault is not running on the computer.';
      case 'vault_phone_off':
        return 'Phone access is switched off in Solco Vault on the computer.';
      case 'vault_reveal_off':
        return 'Showing values on the phone is switched off in Solco Vault on the computer.';
      case 'vault_locked':
        return 'The vault is locked — unlock it on the computer.';
      case 'vault_not_found':
        return 'That item or field no longer exists.';
      case 'vault_note':
        return 'Secure notes are read on the computer only.';
    }
    if (error.kind === 'transport') return 'Could not reach the computer. Pull to try again.';
  }
  return 'The computer did not answer. Pull to try again.';
}

export type VaultNoticeAction = { kind: 'show'; request: NotificationRequest } | { kind: 'dismiss' } | { kind: 'none' };

export function vaultNotice(frame: VaultFrame): VaultNoticeAction {
  if (frame.kind === 'resolved' || frame.id === undefined) return frame.kind === 'resolved' ? { kind: 'dismiss' } : { kind: 'none' };
  const identifier = `${VAULT_NOTIFICATION_PREFIX}${frame.id}`;
  const route = JSON.stringify({ pathname: '/vault' });
  const what = frame.reveal ? 'wants to see a value' : 'wants to use secrets';
  return {
    kind: 'show',
    request: {
      identifier,
      title: frame.project ? `${frame.project} ${what}` : `A command ${what}`,
      body: frame.preview || (frame.waiting > 1 ? `${frame.waiting} requests are waiting.` : 'Open Vault to answer.'),
      data: { route, vault: frame.id },
    },
  };
}
