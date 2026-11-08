// [INPUT]: an interval.
// [OUTPUT]: useNow(intervalMs) → the current time in ms, re-read on that interval.
// [POS]: lets "5 min ago" labels age while a list stays on screen; the pure label models take `now` as an argument.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { useEffect, useState } from 'react';

export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
