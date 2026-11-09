// [INPUT]: the controller's `PageState`, a `call` handler (the page's `chat.*` bridge), an optional seed draft and
//           an `onReady` (the page's HTML is up — the host takes its loading cover down).
// [OUTPUT]: ChatPageView — the desktop's own Chat page (solco/frontend, generated `CHAT_PAGE_HTML`) in a
//           react-native-webview; page calls go to `onCall`, every new state is pushed as the `chat:updated` event.
// [POS]: native (Android/iOS) host of the shared Chat page; `chat-page-view.web.tsx` is its Web/PWA twin.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
// Invariants: the page loads offline from the embedded string and can only talk to its bridge; a tapped web link
//             leaves for the system browser, never navigates the page.
import { useCallback, useEffect, useMemo, useRef, type ComponentType, type Ref } from 'react';
import { Linking } from 'react-native';
import WebViewJsx, { type WebViewMessageEvent } from 'react-native-webview';

import { CHAT_PAGE_HTML } from '@/generated/chat-page';
import { deliverScript, draftSeed, errorMessage, eventMessage, isPageReady, MYGO_SHIM, parsePageCall, resultMessage, themeSeed, withShim, type ToPage } from '@/features/chat-web/protocol';
import type { PageState } from '@/features/chat-web/page-state';
import { activeScheme, colors } from '@/theme/tokens';

// react-native-webview's class declaration infers `never` props under JSX (same note as native-terminal.tsx);
// this pins the surface we use.
interface WebViewNativeProps {
  ref?: Ref<{ injectJavaScript: (script: string) => void } | null>;
  style: { flex: number; backgroundColor: string };
  source: { html: string; baseUrl: string };
  originWhitelist: string[];
  javaScriptEnabled: boolean;
  domStorageEnabled: boolean;
  onMessage: (event: WebViewMessageEvent) => void;
  onLoadStart: () => void;
  onLoadEnd: () => void;
  onShouldStartLoadWithRequest: (request: { url: string }) => boolean;
  setSupportMultipleWindows: boolean;
  allowFileAccess: boolean;
  mixedContentMode: 'never';
  overScrollMode: 'never';
  bounces: boolean;
  textZoom: number;
  automaticallyAdjustContentInsets: boolean;
  webviewDebuggingEnabled: boolean;
}
const WebView = WebViewJsx as unknown as ComponentType<WebViewNativeProps>;

const BASE_URL = 'https://solco.page.invalid/';

export interface ChatPageViewProps {
  state: PageState | null;
  conversationId: string;
  seedDraft?: string;
  /** A sub-agent id whose drawer opens once the page lists it (asked once). */
  openSubagent?: string;
  onCall(method: string, args: readonly unknown[]): Promise<unknown>;
  /** The page's HTML has loaded and its first state went out: the host can take its loading cover down. */
  onReady?: () => void;
}

export function ChatPageView({ state, conversationId, seedDraft = '', openSubagent, onCall, onReady }: ChatPageViewProps) {
  const ref = useRef<{ injectJavaScript: (script: string) => void } | null>(null);
  const ready = useRef(false);
  const readyRef = useRef(onReady);
  readyRef.current = onReady;
  const latest = useRef(state);
  const scheme = activeScheme();
  const html = useMemo(
    () => withShim(CHAT_PAGE_HTML, themeSeed(scheme) + MYGO_SHIM + draftSeed(conversationId, seedDraft)),
    [scheme, conversationId, seedDraft],
  );

  const post = useCallback((message: ToPage) => ref.current?.injectJavaScript(deliverScript(message)), []);

  // The drawer ask follows the state that lists its sub-agent (the page opens a drawer only for a listed id).
  const asked = useRef(false);
  const askSubagent = useCallback(() => {
    if (asked.current || !openSubagent || !ready.current || !latest.current?.subagents?.some((sub) => sub.id === openSubagent)) return;
    asked.current = true;
    post(eventMessage('chat:subagent-open', openSubagent));
  }, [openSubagent, post]);

  // Native WebView messaging is an imperative side effect: never inject
  // JavaScript during React's render (concurrent/aborted renders could leak
  // stale frames to the page). Only publish committed state after the page is ready.
  useEffect(() => {
    ready.current = false;
    asked.current = false;
  }, [html]);
  useEffect(() => {
    latest.current = state;
    if (ready.current && state) {
      post(eventMessage('chat:updated', state));
      askSubagent();
    }
  }, [state, askSubagent, post]);

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      if (isPageReady(event.nativeEvent.data)) {
        readyRef.current?.();
        return;
      }
      const call = parsePageCall(event.nativeEvent.data);
      if (!call) return;
      onCall(call.method, call.args).then(
        (value) => post(resultMessage(call.id, value ?? null)),
        (error: unknown) => post(errorMessage(call.id, error instanceof Error ? error.message : String(error))),
      );
    },
    [onCall, post],
  );

  return (
    <WebView
      ref={ref}
      style={{ flex: 1, backgroundColor: colors.canvas }}
      source={{ html, baseUrl: BASE_URL }}
      originWhitelist={['*']}
      javaScriptEnabled
      domStorageEnabled
      onMessage={onMessage}
      onLoadStart={() => { ready.current = false; }}
      onLoadEnd={() => {
        ready.current = true;
        if (latest.current) post(eventMessage('chat:updated', latest.current));
        askSubagent();
        // Fallback safety: if no pageReady signal was received within 600ms, reveal the page.
        setTimeout(() => {
          readyRef.current?.();
        }, 600);
      }}
      onShouldStartLoadWithRequest={(request) => {
        if (request.url === BASE_URL || request.url.startsWith('about:') || request.url.startsWith('data:')) return true;
        if (/^(https?|mailto):/i.test(request.url)) void Linking.openURL(request.url);
        return false;
      }}
      setSupportMultipleWindows={false}
      allowFileAccess={false}
      mixedContentMode="never"
      overScrollMode="never"
      bounces={false}
      textZoom={100}
      automaticallyAdjustContentInsets={false}
      webviewDebuggingEnabled={__DEV__}
    />
  );
}
