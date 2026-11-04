// [INPUT]: how many automatic attempts have run in this outage and the failure code of the last one.
// [OUTPUT]: `reconnectDelay(attempt, code)` → wait in ms before the next attempt, or null to give up on that
//           (refusal) code; `RECONNECT_WINDOW_MS` (how long one outage is fought); `SIGNAL_TIMEOUT_MS`, `ATTEMPT_TIMEOUT_MS`, `PROBE_MS`,
//           `RECONNECT_TIER`, `RESTORE_AFTER_MS`.
// [POS]: The policy half of Remote Desktop's seamless reconnect (RdSession owns the timers, the picture stays
//        frozen on screen meanwhile). Every failure — a lost link, an unreachable Mac, a relay hiccup, `busy`
//        (the Mac still holds the dying session; it releases a phone's own stale session on the next offer),
//        `internal`/`helper_failed` (a capture restart racing the takeover) — is retried for two minutes; only
//        a refusal (denied, disabled, permission, protocol, display gone) is the Mac speaking and stops it.
//        The first offer of an outage asks for the lightest tier (`RECONNECT_TIER`) so the link comes up before
//        the picture is heavy; `RESTORE_AFTER_MS` later the user's own tier returns.
// [PROTOCOL]: 变更时更新此头部

const LADDER_MS = [300, 700, 1_500, 3_000, 5_000];
/** The Mac speaking: it will not accept this phone, retrying would only nag its user. Anything else is a bad moment. */
const FATAL = new Set(['remote_disabled', 'permission_required', 'denied', 'approval_timeout', 'protocol_unsupported', 'display_not_found']);

/** One outage is fought this long, then the session fails and the lobby explains. */
export const RECONNECT_WINDOW_MS = 120_000;
/** The Mac must answer an offer within this long, or the attempt is replaced (a dead route hangs, it does not refuse). */
export const SIGNAL_TIMEOUT_MS = 10_000;
/** Once the Mac answered, ICE + DTLS + the control channel get this long before the next attempt is scheduled. */
export const ATTEMPT_TIMEOUT_MS = 12_000;
/** After a network change the live link has this long to answer a ping before it is declared lost. */
export const PROBE_MS = 1_500;
/** A reconnect asks for the lightest tier (720p, ≤2.5 Mbps) so the link comes up before the picture is heavy. */
export const RECONNECT_TIER = 'smooth' as const;
/** The user's tier returns after the light link has held this long. */
export const RESTORE_AFTER_MS = 4_000;

/** A lost link, an unreachable Mac, a relay hiccup, `busy`, `internal`, `helper_failed` … all pass; only a refusal stops. */
export function isRetryable(code: string | undefined): boolean {
  return code === undefined || !FATAL.has(code);
}

/** 0.3, 0.7, 1.5, 3, 5 s, then every 5 s. */
export function reconnectDelay(attempt: number, code: string | undefined): number | null {
  if (!isRetryable(code) || attempt < 0) return null;
  return LADDER_MS[Math.min(attempt, LADDER_MS.length - 1)] ?? null;
}
