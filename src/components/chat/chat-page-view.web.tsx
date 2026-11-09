// [INPUT]: same props as the native `chat-page-view.tsx`.
// [OUTPUT]: ChatPageView for Web/PWA — the same generated page in a same-origin `srcDoc` iframe; calls arrive by
//           `postMessage` from the frame, events and results are posted back.
// [POS]: Web twin of the native host; the page and its bridge protocol are identical (features/chat-web/protocol).
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
// Invariants: only messages from this frame's own window are honoured; `allow-same-origin` is needed for the page's
//             draft `sessionStorage` and is safe because the page is this app's own embedded bundle.
import { useEffect, useMemo, useRef } from 'react';

import { CHAT_PAGE_HTML } from '@/generated/chat-page';
import { draftSeed, errorMessage, eventMessage, isPageReady, MYGO_SHIM, parsePageCall, resultMessage, themeSeed, withShim, type ToPage } from '@/features/chat-web/protocol';
import { activeScheme } from '@/theme/tokens';

import type { ChatPageViewProps } from './chat-page-view';

export function ChatPageView({ state, conversationId, seedDraft = '', openSubagent, onCall, onReady }: ChatPageViewProps) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  const scheme = activeScheme();
  const html = useMemo(
    () => withShim(CHAT_PAGE_HTML, themeSeed(scheme) + MYGO_SHIM + draftSeed(conversationId, seedDraft)),
    [scheme, conversationId, seedDraft],
  );
  const post = (message: ToPage) => frame.current?.contentWindow?.postMessage(JSON.stringify(message), '*');
  const latest = useRef({ state, onCall, onReady });
  latest.current = { state, onCall, onReady };
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || typeof event.data !== 'string') return;
      if (isPageReady(event.data)) {
        latest.current.onReady?.();
        return;
      }
      const call = parsePageCall(event.data);
      if (!call) return;
      latest.current.onCall(call.method, call.args).then(
        (value) => post(resultMessage(call.id, value ?? null)),
        (error: unknown) => post(errorMessage(call.id, error instanceof Error ? error.message : String(error))),
      );
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const asked = useRef(false);
  useEffect(() => {
    if (!state) return;
    post(eventMessage('chat:updated', state));
    if (!asked.current && openSubagent && state.subagents?.some((sub) => sub.id === openSubagent)) {
      asked.current = true;
      post(eventMessage('chat:subagent-open', openSubagent));
    }
  }, [state, openSubagent]);

  return (
    <iframe
      ref={frame}
      title="Chat"
      srcDoc={html}
      sandbox="allow-scripts allow-same-origin allow-popups"
      onLoad={() => {
        if (latest.current.state) post(eventMessage('chat:updated', latest.current.state));
        setTimeout(() => latest.current.onReady?.(), 600);
      }}
      style={{ flex: 1, width: '100%', height: '100%', border: 0, background: 'transparent' }}
    />
  );
}
