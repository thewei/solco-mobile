// [INPUT]: the Mac's tier names.
// [OUTPUT]: human labels/hints for the quality picker and the per-session connection-state vocabulary.
// [POS]: Presentation constants only; the encoder numbers live on the Mac (protocol/quality.go).
// [PROTOCOL]: 变更时更新此头部
import type { RdTier } from '@/contracts/host-v3';

export const TIER_LABEL: Record<RdTier, { title: string; hint: string }> = {
  smooth: { title: 'Smooth', hint: '720p · least data, fastest on weak Wi-Fi' },
  standard: { title: 'Standard', hint: '1080p · balanced' },
  high: { title: 'Sharp', hint: '1440p · best for reading text on a good link' },
};

export const REFUSAL_COPY: Record<string, string> = {
  remote_disabled: 'Remote Desktop is off on the Mac. Turn it on in Solco ▸ Settings ▸ Remote Desktop.',
  remote_unavailable: 'This Mac cannot share its screen right now.',
  protocol_unsupported: 'The Mac and this app speak different Remote Desktop versions. Update the older one.',
  permission_required: 'Allow Screen Recording for Solco on the Mac (System Settings ▸ Privacy & Security).',
  denied: 'The person at the Mac declined.',
  approval_timeout: 'Nobody answered on the Mac in time.',
  busy: 'Another phone is already using this Mac’s screen.',
  bad_request: 'The request was not accepted. Try again.',
  bad_offer: 'The connection could not be negotiated. Try again.',
  display_not_found: 'That display is no longer connected.',
  helper_failed: 'The Mac’s screen helper did not start. Reopen Solco on the Mac.',
  unlock_unavailable: 'No Mac password is saved. Add one in Solco ▸ Settings ▸ Remote Desktop ▸ Lock screen.',
  unlock_failed: 'The Mac is still locked. Check the saved password on the Mac.',
  privacy_unavailable: 'This Mac cannot black out its screen.',
  internal: 'The Mac hit an error. Try again.',
};
