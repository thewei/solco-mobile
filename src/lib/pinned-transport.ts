// [INPUT]: a native module implementing pinned HTTPS + WebSocket (modules/solco-pinned-transport).
// [OUTPUT]: createPinnedTransport(native) → { request, openSocket }; typed errors; Uint8Array/base64 glue.
// [POS]: Transport seam for the Go Host v3. A self-signed Host certificate can only be trusted by
//        fingerprint, which React Native's fetch/WebSocket cannot express, so every v3 call goes
//        through this module. Pure TS (the native binding lives in pinned-transport-native.ts) so
//        the contract is testable in Node with a fake.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
// Invariants: only https/wss; a certificate other than the pinned one fails with PinMismatchError
// before any request bytes are sent; redirects are never followed; socket events are routed by
// id and a closed socket never delivers again.

const FINGERPRINT = /^[0-9a-fA-F]{64}$/;

export class PinnedTransportError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'PinnedTransportError';
    this.code = code;
  }
}

/** The Host presented a certificate other than the one the pairing link named. */
export class PinMismatchError extends PinnedTransportError {
  constructor(message = "the Host's certificate is not the one that was paired") {
    super('ERR_PIN_MISMATCH', message);
    this.name = 'PinMismatchError';
  }
}

export type SocketEvent =
  | { id: string; type: 'open' }
  | { id: string; type: 'text'; data: string }
  | { id: string; type: 'binary'; data: string }
  | { id: string; type: 'closed'; code: number; reason: string }
  | { id: string; type: 'failed'; message: string; pinMismatch: boolean; status: number };

/** What the Expo module exposes; every argument is positional, as Expo functions are. */
export interface NativePinnedTransport {
  request(
    url: string,
    method: string,
    headers: Record<string, string>,
    body: string | null,
    fingerprint: string,
    timeoutMs: number,
  ): Promise<{ status: number; headers: Record<string, string>; body: string }>;
  openSocket(id: string, url: string, protocols: string[], fingerprint: string): void;
  sendText(id: string, text: string): void;
  sendBinary(id: string, base64: string): void;
  closeSocket(id: string, code: number, reason: string): void;
  addListener(event: 'onSocketEvent', listener: (event: SocketEvent) => void): { remove(): void };
}

export interface PinnedRequestOptions {
  url: string;
  fingerprint: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

export interface PinnedResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface PinnedSocketHandlers {
  onOpen?(): void;
  onText?(text: string): void;
  onBinary?(bytes: Uint8Array): void;
  /** Normal or abnormal end; always delivered once, after any error. */
  onClose?(event: { code: number; reason: string }): void;
  onError?(error: PinnedTransportError): void;
}

export interface PinnedSocket {
  sendText(text: string): void;
  sendBinary(bytes: Uint8Array): void;
  close(code?: number, reason?: string): void;
}

export interface PinnedTransport {
  request(options: PinnedRequestOptions): Promise<PinnedResponse>;
  openSocket(
    options: { url: string; fingerprint: string; protocols?: string[] },
    handlers: PinnedSocketHandlers,
  ): PinnedSocket;
}

const DEFAULT_TIMEOUT_MS = 15_000;
/** Abnormal closure, as the WebSocket spec names it. */
const CLOSE_ABNORMAL = 1006;

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function requireFingerprint(fingerprint: string): string {
  if (!FINGERPRINT.test(fingerprint)) {
    throw new PinnedTransportError('ERR_INVALID_ARGUMENT', 'fingerprint must be 64 hex characters');
  }
  return fingerprint.toLowerCase();
}

/** Native CodedException → typed error; anything else is wrapped so callers catch one family. */
function translate(error: unknown): PinnedTransportError {
  if (error instanceof PinnedTransportError) return error;
  const code = (error as { code?: unknown } | null)?.code;
  const message = error instanceof Error ? error.message : String(error);
  if (code === 'ERR_PIN_MISMATCH') return new PinMismatchError();
  return new PinnedTransportError(typeof code === 'string' ? code : 'ERR_TRANSPORT', message);
}

export function createPinnedTransport(native: NativePinnedTransport): PinnedTransport {
  const sockets = new Map<string, PinnedSocketHandlers>();
  let listener: { remove(): void } | null = null;
  let nextId = 0;

  function ensureListener() {
    if (listener) return;
    listener = native.addListener('onSocketEvent', (event) => {
      const handlers = sockets.get(event.id);
      if (!handlers) return;
      switch (event.type) {
        case 'open':
          handlers.onOpen?.();
          return;
        case 'text':
          handlers.onText?.(event.data);
          return;
        case 'binary':
          handlers.onBinary?.(base64ToBytes(event.data));
          return;
        case 'closed':
          sockets.delete(event.id);
          handlers.onClose?.({ code: event.code, reason: event.reason });
          return;
        case 'failed':
          sockets.delete(event.id);
          handlers.onError?.(
            event.pinMismatch ? new PinMismatchError() : new PinnedTransportError('ERR_TRANSPORT', event.message),
          );
          handlers.onClose?.({ code: CLOSE_ABNORMAL, reason: event.message });
          return;
      }
    });
  }

  return {
    async request(options) {
      if (!options.url.startsWith('https://')) {
        throw new PinnedTransportError('ERR_INVALID_ARGUMENT', 'only https:// is allowed');
      }
      const fingerprint = requireFingerprint(options.fingerprint);
      try {
        return await native.request(
          options.url,
          options.method ?? 'GET',
          options.headers ?? {},
          options.body ?? null,
          fingerprint,
          options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        );
      } catch (error) {
        throw translate(error);
      }
    },

    openSocket(options, handlers) {
      if (!options.url.startsWith('wss://')) {
        throw new PinnedTransportError('ERR_INVALID_ARGUMENT', 'only wss:// is allowed');
      }
      const fingerprint = requireFingerprint(options.fingerprint);
      ensureListener();
      nextId += 1;
      const id = `s${nextId}`;
      sockets.set(id, handlers);
      try {
        native.openSocket(id, options.url, options.protocols ?? [], fingerprint);
      } catch (error) {
        sockets.delete(id);
        throw translate(error);
      }
      const live = () => sockets.has(id);
      return {
        sendText(text) {
          if (live()) native.sendText(id, text);
        },
        sendBinary(bytes) {
          if (live()) native.sendBinary(id, bytesToBase64(bytes));
        },
        close(code = 1000, reason = '') {
          if (live()) native.closeSocket(id, code, reason);
        },
      };
    },
  };
}
