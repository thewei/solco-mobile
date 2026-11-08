// [INPUT]: a value that changes as the user types, and a delay.
// [OUTPUT]: useDebounced — the value once it has stood still for the delay; SEARCH_DELAY_MS — the one delay a search that asks the Mac waits.
// [POS]: Searches that run on the Mac (Sessions, Files) wait for the typing to pause instead of asking once per keystroke.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { useEffect, useState } from 'react';

/** How long typing must pause before a search that runs on the Mac asks. */
export const SEARCH_DELAY_MS = 300;

export function useDebounced<T>(value: T, delayMs: number = SEARCH_DELAY_MS): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
