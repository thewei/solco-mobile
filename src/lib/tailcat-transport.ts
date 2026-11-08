// [INPUT]: the local Expo module `SolcoTailcatTransport` (modules/solco-tailcat-transport, over the
//          gomobile Tailcat bridge AAR) and the active HostConnectionV3's tunnel address.
// [OUTPUT]: getTailcatTransport(connection) → a PinnedTransport over the Mac's built-in tunnel, or
//           null where no native bridge exists; tailcatClientKey() → the phone's node public key
//           sent with every pair so the Mac can admit the tunnel after the pairing window closes.
// [POS]: The only file that touches the Tailcat native binding. Android ships first; iOS and Web
//        return null, so callers degrade explicitly. The URL's host is a label only — the bridge
//        dials one fixed virtual port of the paired tunnel — so the same request/openSocket seam
//        the direct LAN transport serves works unchanged here.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { requireOptionalNativeModule } from 'expo';
import * as SecureStore from 'expo-secure-store';

import { utf8Encode } from '@/lib/p2p-codec';
import {
  base64ToBytes,
  bytesToBase64,
  PinnedTransportError,
  type PinnedRequestOptions,
  type PinnedResponse,
  type PinnedSocket,
  type PinnedSocketHandlers,
  type PinnedTransport,
} from '@/lib/pinned-transport';
import type { HostConnectionV3 } from '@/lib/host-connection-v3';

/** Events the Kotlin module emits on `onSocketEvent`, keyed by the caller-chosen socket id. */
type TailcatSocketEvent =
  | { id: string; type: 'open' }
  | { id: string; type: 'text'; data: string }
  | { id: string; type: 'binary'; data: string }
  | { id: string; type: 'close'; code: number; reason: string }
  | { id: string; type: 'error'; message: string; pinMismatch: boolean; httpStatus: number };

interface NativeTailcatTransport {
  generateNodeKey(): Promise<string>;
  publicKeyOf(nodeKey: string): Promise<string>;
  clientNew(handle: string, tc: string, nodeKey: string, pinHex: string): Promise<null>;
  clientRequest(
    handle: string,
    method: string,
    path: string,
    headersJson: string,
    bodyB64: string | null,
    timeoutMs: number,
  ): Promise<{ status: number; body: string }>;
  openSocket(handle: string, id: string, path: string, protocolsCsv: string): void;
  socketSendText(id: string, text: string): void;
  socketSendBinary(id: string, base64: string): void;
  socketClose(id: string, code: number, reason: string): void;
  clientClose(handle: string): void;
  addListener(event: 'onSocketEvent', listener: (event: TailcatSocketEvent) => void): { remove(): void };
}

const NODE_KEY_STORE = 'tailcat.nodekey';
let native: NativeTailcatTransport | null | undefined;
/** The phone's tunnel identity, generated once and kept in SecureStore like the rest of the book. */
let nodeKeyPromise: Promise<string | null> | null = null;

function mod(): NativeTailcatTransport | null {
  if (native === undefined) {
    native = requireOptionalNativeModule<NativeTailcatTransport>('SolcoTailcatTransport');
  }
  return native;
}

async function nodeKey(): Promise<string | null> {
  const m = mod();
  if (!m) return null;
  if (!nodeKeyPromise) {
    nodeKeyPromise = (async () => {
      const stored = await SecureStore.getItemAsync(NODE_KEY_STORE, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
      if (stored) return stored;
      const fresh = await m.generateNodeKey();
      await SecureStore.setItemAsync(NODE_KEY_STORE, fresh, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
      return fresh;
    })();
  }
  return nodeKeyPromise;
}

/** The node public key a pair body carries (`clientKey`); null without the native bridge. */
export async function tailcatClientKey(): Promise<string | null> {
  const m = mod();
  const key = await nodeKey();
  if (!m || !key) return null;
  return m.publicKeyOf(key);
}

/** `/api/v3/...` of a pinned-transport URL; the tunnel never sees a host, only the path. */
function pathOf(url: string): string {
  const match = /^[a-z]+:\/\/[^/]+(\/.*)$/i.exec(url);
  return match?.[1] ?? '/';
}

const clients = new Map<string, Promise<string | null>>();
/** What each live client was built from, so it can be rebuilt after a network change. */
const built = new Map<string, { handle: string; tc: string; fingerprint: string }>();
/** Resolves once the latest rebuild finished; requests wait on it so they never hit a client being replaced. */
let settled: Promise<void> = Promise.resolve();

/**
 * The phone's network changed (Wi-Fi ↔ cellular, a new address): a long-lived tunnel client keeps paths of
 * the old network and does not recover on its own, so every open client is rebuilt with the same node key.
 * The handles stay valid, so transports already handed out keep working; nothing is replayed.
 */
export function resetTailcatClients(): Promise<void> {
  const m = mod();
  if (!m || built.size === 0) return settled;
  const targets = [...built.values()];
  settled = settled.then(async () => {
    const key = await nodeKey();
    if (!key) return;
    for (const target of targets) {
      try {
        await m.clientNew(target.handle, target.tc, key, target.fingerprint);
      } catch {
        // The next request surfaces the failure on its own; a rebuild that cannot happen changes nothing.
      }
    }
  });
  return settled;
}

function handleFor(connection: Pick<HostConnectionV3, 'fingerprint' | 'tailcat'>): Promise<string | null> {
  const cached = clients.get(connection.fingerprint);
  if (cached) return cached;
  const creating = (async () => {
    const m = mod();
    const key = await nodeKey();
    if (!m || !key || !connection.tailcat) return null;
    const handle = `tc-${connection.fingerprint.slice(0, 12)}`;
    await m.clientNew(handle, connection.tailcat, key, connection.fingerprint);
    built.set(connection.fingerprint, { handle, tc: connection.tailcat, fingerprint: connection.fingerprint });
    return handle;
  })();
  clients.set(connection.fingerprint, creating);
  return creating;
}

/** A PinnedTransport that speaks through the Mac's built-in tunnel; null without the native bridge. */
export async function getTailcatTransport(
  connection: Pick<HostConnectionV3, 'fingerprint' | 'tailcat'>,
): Promise<PinnedTransport | null> {
  const m = mod();
  if (!m || !connection.tailcat) return null;
  const handle = await handleFor(connection);
  if (!handle) return null;

  let socketSeq = 0;

  return {
    async request(init: PinnedRequestOptions): Promise<PinnedResponse> {
      await settled;
      try {
        const response = await m.clientRequest(
          handle,
          init.method ?? 'GET',
          pathOf(init.url),
          JSON.stringify(init.headers ?? {}),
          init.body ? bytesToBase64(utf8Encode(init.body)) : null,
          init.timeoutMs ?? 15_000,
        );
        return { status: response.status, headers: {}, body: response.body };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new PinnedTransportError(message.includes('pin_mismatch') ? 'ERR_PIN_MISMATCH' : 'ERR_REQUEST_FAILED', message);
      }
    },
    openSocket(
      options: { url: string; protocols?: string[] },
      handlers: PinnedSocketHandlers,
    ): PinnedSocket {
      const id = `tc-s${(socketSeq += 1)}`;
      let closed = false;
      const finish = () => {
        if (closed) return;
        closed = true;
        handlers.onClose?.({ code: 1006, reason: '' });
      };
      const listener = (event: TailcatSocketEvent): void => {
        if (event.id !== id) return;
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
          case 'close':
            closed = true;
            handlers.onClose?.({ code: event.code, reason: event.reason });
            return;
          case 'error':
            handlers.onError?.(
              new PinnedTransportError(
                event.pinMismatch ? 'ERR_PIN_MISMATCH' : 'ERR_SOCKET_FAILED',
                event.message || 'the tunnel socket failed',
              ),
            );
            finish();
        }
      };
      const subscription = m.addListener('onSocketEvent', listener);
      m.openSocket(handle, id, pathOf(options.url), (options.protocols ?? []).join(','));
      return {
        sendText: (text: string) => m.socketSendText(id, text),
        sendBinary: (bytes: Uint8Array) => m.socketSendBinary(id, bytesToBase64(bytes)),
        close: (code = 1000, reason = '') => {
          m.socketClose(id, code, reason);
          finish();
        },
      };
    },
  };
}
