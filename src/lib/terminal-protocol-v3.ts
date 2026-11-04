// [INPUT]: the Go Host's terminal stream: JSON text headers followed by binary ANSI frames,
//          and the messages the phone sends back.
// [OUTPUT]: terminalStreamPath, encodeInput/encodeResize/encodePing, decodeServerText and
//           createFrameAssembler (pairs each text header with the binary frame that follows).
// [POS]: Pure protocol codec for `WS /api/v3/terminals/{id}/stream` — no sockets, no timers,
//        no react-native. The transport owner feeds it frames and renders what it returns.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
// Invariants: the client refuses to send what the Host would reject (limits mirrored from the
// Go side); a resize is a stream restart on the Host (new grid → full first frame), so callers
// debounce it; a binary frame without a preceding header is dropped, never guessed at.
import {
  V3_API_PREFIX,
  V3_KEY_NAME,
  V3_LIMITS,
  terminalServerMessageSchema,
  type TerminalServerMessage,
} from '@/contracts/host-v3';

export interface TerminalGrid {
  cols: number;
  rows: number;
}

export function isValidGrid({ cols, rows }: TerminalGrid): boolean {
  return (
    Number.isInteger(cols) &&
    Number.isInteger(rows) &&
    cols >= V3_LIMITS.minCols &&
    cols <= V3_LIMITS.maxCols &&
    rows >= V3_LIMITS.minRows &&
    rows <= V3_LIMITS.maxRows
  );
}

/** Clamp a measured grid into what the Host accepts (a tiny or huge viewport must not be refused). */
export function clampGrid({ cols, rows }: TerminalGrid): TerminalGrid {
  const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(n)));
  return {
    cols: clamp(cols, V3_LIMITS.minCols, V3_LIMITS.maxCols),
    rows: clamp(rows, V3_LIMITS.minRows, V3_LIMITS.maxRows),
  };
}

/** Path + query for the stream. The terminal id is opaque, so it is always percent-encoded. */
export function terminalStreamPath(terminalId: string, grid: TerminalGrid, instance?: string): string {
  if (!terminalId) throw new Error('terminalId is required');
  if (!isValidGrid(grid)) throw new Error(`grid ${grid.cols}x${grid.rows} is outside the Host's limits`);
  const query = [`cols=${grid.cols}`, `rows=${grid.rows}`];
  if (instance) query.push(`instance=${encodeURIComponent(instance)}`);
  return `${V3_API_PREFIX}/terminals/${encodeURIComponent(terminalId)}/stream?${query.join('&')}`;
}

/** UTF-8 byte length without TextEncoder (not guaranteed on every Hermes build). */
export function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return bytes;
}

export interface TerminalInput {
  /** Literal text, written first. */
  text?: string;
  /** Named keys (`enter`, `ctrl+c`, `up` …), pressed after the text. */
  keys?: string[];
}

/** Returns null when the Host would refuse the message (empty, oversized, or a bad key name). */
export function encodeInput(input: TerminalInput): string | null {
  const text = input.text ?? '';
  const keys = input.keys ?? [];
  if (text === '' && keys.length === 0) return null;
  if (utf8ByteLength(text) > V3_LIMITS.maxInputTextBytes) return null;
  if (keys.length > V3_LIMITS.maxInputKeys || !keys.every((key) => V3_KEY_NAME.test(key))) return null;
  const message: { t: 'input'; text?: string; keys?: string[] } = { t: 'input' };
  if (text !== '') message.text = text;
  if (keys.length > 0) message.keys = keys;
  return JSON.stringify(message);
}

export function encodeResize(grid: TerminalGrid): string | null {
  return isValidGrid(grid) ? JSON.stringify({ t: 'resize', cols: grid.cols, rows: grid.rows }) : null;
}

export const ENCODED_PING = JSON.stringify({ t: 'ping' });

/** Parses one text frame from the Host; unknown or malformed frames are null (ignored). */
export function decodeServerText(raw: string): TerminalServerMessage | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = terminalServerMessageSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

export interface TerminalFrame {
  seq: number;
  /** A full frame replaces the whole screen; a delta applies on top of the previous state. */
  full: boolean;
  width: number;
  height: number;
  /** Raw ANSI bytes, exactly as Herdr rendered them. */
  bytes: Uint8Array;
}

export type TerminalEvent =
  | { kind: 'frame'; frame: TerminalFrame }
  | { kind: 'pong' }
  | { kind: 'input-error'; code: 'bad_input' | 'refused' | 'forbidden'; message?: string };

export interface FrameAssembler {
  text(raw: string): TerminalEvent | null;
  binary(bytes: Uint8Array): TerminalEvent | null;
  /** Forget a pending header (the socket restarted). */
  reset(): void;
}

/**
 * Each frame is a text header then a binary body. The assembler holds the header until
 * its body arrives; a second header before a body replaces the first (the body was lost),
 * and a body with no header is dropped.
 */
export function createFrameAssembler(): FrameAssembler {
  let pending: { seq: number; full: boolean; width: number; height: number } | null = null;
  return {
    text(raw) {
      const message = decodeServerText(raw);
      if (!message) return null;
      switch (message.t) {
        case 'frame':
          pending = { seq: message.seq, full: message.full, width: message.w, height: message.h };
          return null;
        case 'pong':
          return { kind: 'pong' };
        case 'input.error':
          return { kind: 'input-error', code: message.code, message: message.message };
      }
    },
    binary(bytes) {
      if (!pending) return null;
      const header = pending;
      pending = null;
      return { kind: 'frame', frame: { ...header, bytes } };
    },
    reset() {
      pending = null;
    },
  };
}
