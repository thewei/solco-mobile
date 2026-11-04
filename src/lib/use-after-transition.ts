// [INPUT]: the screen's navigation object (Expo Router) and a fallback delay.
// [OUTPUT]: useAfterTransition() → false while the push animation runs, true once it has ended.
// [POS]: Heavy children (the Chat WebView, a long list) mount after the slide instead of during it, so the
//        transition stays on the UI thread's budget and the screen shows a plain canvas spinner for those
//        ~250 ms.
//        The native stack emits `transitionEnd`; the timer is a fallback for navigators that do not (and for a
//        screen opened with no animation).
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { useNavigation } from 'expo-router';
import { useEffect, useState } from 'react';

export function useAfterTransition(fallbackMs = 450): boolean {
  const navigation = useNavigation();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const done = () => setReady(true);
    const unsubscribe = (navigation as unknown as { addListener: (event: string, cb: () => void) => () => void }).addListener('transitionEnd', done);
    const timer = setTimeout(done, fallbackMs);
    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, [navigation, fallbackMs]);
  return ready;
}
