// [INPUT]: the Home tab group.
// [OUTPUT]: the Home group layout — a pass-through that keeps `(home)` a route group, so the Chats tab is still `/`.
// [POS]: The side drawer is gone (2026-11-07 phone redesign): its session list lives in the Sessions tab and its
//        instance switch in the Chats filter. The bottom bar is the `(tabs)` layout's.
// [PROTOCOL]: 变更时更新此头部，然后检查 ../CLAUDE.md
import { Slot } from 'expo-router';

export default function HomeLayout() {
  return <Slot />;
}
