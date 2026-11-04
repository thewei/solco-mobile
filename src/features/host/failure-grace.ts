// [INPUT]: whether a read is failing, whether the screen still holds its last answer, and what kind of failure it is.
// [OUTPUT]: `blocksScreen` (may a failure replace the screen?) and `useFailureGrace` (has it lasted past the grace period?).
// [POS]: "freeze, then repair": a network change breaks the in-flight reads for a few seconds while the connection
//        manager finds the new way in. The screen keeps the last good data meanwhile and the refetch fills it in;
//        only a failure that is not about the way in (401, pin), a read that never had data, or an outage that
//        outlasts the grace period gets the exact error view.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { useEffect, useState } from 'react';

import { isConnectivityFailure } from '@/features/host/connect-failure';

/** The manager's retry ladder (1/2/4/8/10 s) settles within this; past it the outage is real and gets its own view. */
export const FAILURE_GRACE_MS = 30_000;

/** Whether a failure may replace what the screen shows: it must, unless the screen can keep its last answer while the way in is repaired. */
export function blocksScreen(input: { failure: unknown; hasData: boolean; graceElapsed: boolean }): boolean {
  if (!input.failure) return false;
  if (!input.hasData) return true;
  return !isConnectivityFailure(input.failure) || input.graceElapsed;
}

/** True once `failing` has stayed true for `ms`; resets the moment it clears. */
export function useFailureGrace(failing: boolean, ms: number = FAILURE_GRACE_MS): boolean {
  const [elapsed, setElapsed] = useState(false);
  useEffect(() => {
    if (!failing) {
      setElapsed(false);
      return undefined;
    }
    const timer = setTimeout(() => setElapsed(true), ms);
    return () => clearTimeout(timer);
  }, [failing, ms]);
  return failing && elapsed;
}
