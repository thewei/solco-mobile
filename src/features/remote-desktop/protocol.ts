// [INPUT]: the typed control-channel vocabulary in contracts/host-v3.ts (pinned by the Go Host's goldens).
// [OUTPUT]: `createSender` — builders that stamp the session-wide `seq`, clamp coordinates and refuse
//           what the Mac would drop — and `parseMacMessage`.
// [POS]: The one place a control message is composed or decoded; screens and gestures never hand-write JSON.
// [PROTOCOL]: 变更时更新此头部，然后检查 ../CLAUDE.md（如存在）与 contracts/host-v3.ts
import { RD_LIMITS, rdMacMessageSchema, type RdButton, type RdMacMessage, type RdPhoneMessage, type RdTier } from '@/contracts/host-v3';

export type RdChannelName = 'control' | 'pointer';

/** A message with the channel it must travel on: moves/scroll are loss-tolerant (`pointer`), everything else must arrive (`control`). */
export type Outgoing = { channel: RdChannelName; message: RdPhoneMessage };

export interface NormPoint {
  x: number;
  y: number;
}

const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/** Unicode-safe truncation by code point (never splits a surrogate pair). */
export function truncateRunes(text: string, max: number): string {
  const runes = Array.from(text);
  return runes.length <= max ? text : runes.slice(0, max).join('');
}

export function createSender(emit: (out: Outgoing) => void, displayId?: () => string | undefined) {
  let seq = 0;
  const next = () => ++seq;
  const control = (message: RdPhoneMessage) => emit({ channel: 'control', message });
  const withDisplay = <T extends object>(m: T): T & { displayId?: string } => {
    const id = displayId?.();
    return id ? { ...m, displayId: id } : m;
  };
  return {
    pointerMove(p: NormPoint) {
      emit({ channel: 'pointer', message: withDisplay({ type: 'pointer.move' as const, seq: next(), x: clamp01(p.x), y: clamp01(p.y) }) });
    },
    pointerButton(p: NormPoint, button: RdButton, down: boolean, clickCount = 1) {
      // Buttons are reliable (a lost "up" would leave the Mac dragging) and carry their own position.
      control(withDisplay({ type: 'pointer.button' as const, seq: next(), x: clamp01(p.x), y: clamp01(p.y), button, down, clickCount: Math.min(3, Math.max(1, clickCount)) }));
    },
    pointerScroll(dx: number, dy: number) {
      const cap = (v: number) => Math.round(Math.max(-RD_LIMITS.maxScrollDelta, Math.min(RD_LIMITS.maxScrollDelta, Number.isFinite(v) ? v : 0)));
      const [cx, cy] = [cap(dx), cap(dy)];
      if (cx === 0 && cy === 0) return;
      emit({ channel: 'pointer', message: { type: 'pointer.scroll', seq: next(), dx: cx, dy: cy } });
    },
    key(code: string, down: boolean) {
      control({ type: 'key', code, down });
    },
    /** A tap of one key (down then up) — the Mac keeps order on the reliable channel. */
    tapKey(code: string) {
      control({ type: 'key', code, down: true });
      control({ type: 'key', code, down: false });
    },
    textInsert(text: string) {
      const t = truncateRunes(text, RD_LIMITS.maxTextInsertRunes);
      if (t) control({ type: 'text.insert', text: t });
    },
    clipboardSet(text: string) {
      // The Mac refuses an oversized clipboard; cut on a code-point boundary under the byte cap.
      let t = text;
      while (new TextEncoder().encode(t).length > RD_LIMITS.maxClipboardBytes) t = Array.from(t).slice(0, Math.floor(Array.from(t).length * 0.9)).join('');
      control({ type: 'clipboard.set', text: t });
    },
    clipboardGet() {
      control({ type: 'clipboard.get' });
    },
    displaySelect(displayId: string) {
      control({ type: 'display.select', displayId });
    },
    qualitySet(tier: RdTier) {
      control({ type: 'quality.set', tier });
    },
    cursorSet(visible: boolean) {
      control({ type: 'cursor.set', visible });
    },
    privacySet(on: boolean) {
      control({ type: 'privacy.set', on });
    },
    unlockRequest() {
      control({ type: 'unlock.request' });
    },
    keyframeRequest() {
      control({ type: 'keyframe.request' });
    },
    ping(t: number) {
      control({ type: 'ping', t });
    },
    sessionEnd() {
      control({ type: 'session.end' });
    },
    releaseAll() {
      control({ type: 'input.release_all' });
    },
    statsRequest() {
      control({ type: 'stats.request' });
    },
  };
}
export type Sender = ReturnType<typeof createSender>;

export const encode = (m: RdPhoneMessage): string => JSON.stringify(m);

/** Decode one control-channel text frame; anything unknown or malformed is ignored (null), never thrown. */
export function parseMacMessage(raw: unknown): RdMacMessage | null {
  if (typeof raw !== 'string') return null;
  try {
    const parsed = rdMacMessageSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
