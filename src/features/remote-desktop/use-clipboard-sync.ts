// [INPUT]: the open RdSession, its snapshot's `clipboardIn`, and the user's "Sync clipboard" switch.
// [OUTPUT]: useClipboardSync(session, snap, enabled, onSynced) — polls both clipboards every 2.5 s while the app is
//           in the foreground and copies a changed text across (decisions: clipboard-sync.ts).
// [POS]: React edge of clipboard auto-sync, Control sessions only (the Mac refuses clipboard writes in View only).
//        Text only; the phone's clipboard is read only while the switch is on and the app is in front, and
//        nothing read is logged or kept beyond the last-seen string in memory.
// [PROTOCOL]: 变更时更新此头部
import * as Clipboard from 'expo-clipboard';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { CLIP_START, macRead, phoneRead, type ClipState } from './clipboard-sync';
import type { RdSession, RdSnapshot } from './session';

const POLL_MS = 2_500;

export function useClipboardSync(session: RdSession, snap: Pick<RdSnapshot, 'clipboardIn'>, enabled: boolean, onSynced: (direction: 'toMac' | 'toPhone') => void): void {
  const state = useRef<ClipState>(CLIP_START);
  const notify = useRef(onSynced);
  notify.current = onSynced;

  useEffect(() => {
    if (!enabled) return;
    state.current = CLIP_START;
    let stopped = false;
    const tick = async () => {
      if (AppState.currentState !== 'active') return;
      try {
        const text = await Clipboard.getStringAsync();
        if (stopped) return;
        const next = phoneRead(state.current, text);
        state.current = next.state;
        if (next.send !== null) {
          session.send.clipboardSet(next.send);
          notify.current('toMac');
        }
      } catch {
        // the system refused this read; the next tick tries again
      }
      session.send.clipboardGet();
    };
    void tick();
    const id = setInterval(() => void tick(), POLL_MS);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [enabled, session]);

  useEffect(() => {
    if (!enabled || !snap.clipboardIn) return;
    const next = macRead(state.current, snap.clipboardIn.text);
    state.current = next.state;
    if (next.write !== null) {
      void Clipboard.setStringAsync(next.write);
      notify.current('toPhone');
    }
  }, [enabled, snap.clipboardIn]);
}
