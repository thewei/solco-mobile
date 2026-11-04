// [INPUT]: expo-share-intent's `useShareIntent` (Android ACTION_SEND text/*), the pairing status and the router.
// [OUTPUT]: ShareBridge — renders nothing; hands a shared text to the share store and opens `/share`.
// [POS]: Single owner of the system share entry, mounted once in the root layout (Android only; iOS has no share
//        extension in this app, Web has no share target). A paired phone opens the destination picker; an unpaired
//        one drops the share rather than carrying text across the pairing flow.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { useRouter, useSegments } from 'expo-router';
import { useShareIntent } from 'expo-share-intent';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { sharedPrompt } from '@/features/share/share-model';
import { useHostV3 } from '@/lib/host-v3-provider';
import { useShareStore } from '@/state/share-store';

export function ShareBridge() {
  const router = useRouter();
  const segments = useSegments();
  const { status } = useHostV3();
  // The share must stay pending while the app is backgrounded and back again, so no reset on background.
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent({ disabled: Platform.OS !== 'android', resetOnBackground: false });
  const onSharePage = segments[0] === 'share';

  useEffect(() => {
    if (!hasShareIntent || status === 'loading') return;
    const text = sharedPrompt(shareIntent);
    resetShareIntent();
    if (!text || status === 'unpaired') return;
    useShareStore.getState().receive(text);
    if (!onSharePage) router.push('/share');
  }, [hasShareIntent, shareIntent, status, onSharePage, router, resetShareIntent]);

  return null;
}
