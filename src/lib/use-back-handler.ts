// [INPUT]: whether a sub-state is open (a search, the Trash view) and what closing it does.
// [OUTPUT]: useBackHandler(active, onBack) — while `active` and the screen is focused, the Android system Back runs `onBack`
//           instead of leaving the screen.
// [POS]: The tab screens stay mounted when another tab is chosen, so the handler is bound to focus, not to mount: a search left open on
//        Chats must not swallow Back on Sessions. The bar's own back arrow calls the same `onBack`.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import { BackHandler } from 'react-native';

export function useBackHandler(active: boolean, onBack: () => void) {
  const latest = useRef(onBack);
  useEffect(() => {
    latest.current = onBack;
  }, [onBack]);
  useFocusEffect(
    useCallback(() => {
      if (!active) return undefined;
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        latest.current();
        return true;
      });
      return () => subscription.remove();
    }, [active]),
  );
}
