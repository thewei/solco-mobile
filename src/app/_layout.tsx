// [INPUT]: 依赖 expo-router 的 Stack 路由、@tanstack/react-query 的 QueryClientProvider、
//          @gorhom/bottom-sheet 的 BottomSheetModalProvider、react-native-safe-area-context、
//          react-native-gesture-handler 的 GestureHandlerRootView、tamagui 的 TamaguiProvider，
//          以及 @/lib/host-v3-provider 的已配对 Go Host 连接与 @/features/host/background-bridge 的后台桥。
// [OUTPUT]: 对外提供 RootLayout（Expo Router 根布局）。
// [POS]: src/app 的组合根，持有全局 provider 与配对门禁；web 上额外拥有手机宽度居中外壳缝隙
//        （docs/web-pwa-architecture.md §2），原生渲染路径不经过该外壳，保持零变化。
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
// Invariant: business routes cannot render before a paired Go Host exists.
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { Fragment, useEffect } from 'react';
import { Appearance, Platform, useColorScheme, View, type ViewStyle } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { TamaguiProvider } from 'tamagui';

import { ErrorBoundary } from '@/components/error-boundary';
import { RouteNotice } from '@/components/route-notice';
import { BackgroundBridge } from '@/features/host/background-bridge';
import { ShareBridge } from '@/features/share/share-bridge';
import { resolveScheme } from '@/lib/appearance';
import { HostV3Provider, useHostV3 } from '@/lib/host-v3-provider';
import { hydrateAppearance, useAppearanceStore } from '@/state/appearance-store';
import { hydrateChatPrefs } from '@/state/chat-prefs-store';
import { hydrateResultsSeen } from '@/state/results-store';
import { hydrateLaunchPick } from '@/state/session-store';
import { useAppFonts } from '@/theme/fonts';
import { colors, setActiveScheme, type Scheme } from '@/theme/tokens';
import { tamaguiConfig } from '../../tamagui.config';

// The splash stays up until DM Sans has loaded, so no frame is ever drawn in the system font.
void SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      retry: 3,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 15000),
    },
  },
});

// Web 外壳：视口居中。手机（≤430）窄屏紧凑、Pad/桌面放宽至 1024。
// 四边 0 绝对定位锚定视口，补齐导出 HTML 无高度链的问题。颜色在渲染时读取（浅/深色切换后重算）。
const webShellOuter = (): ViewStyle => ({
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  flex: 1,
  alignItems: 'center',
  backgroundColor: colors.chrome,
  overflowX: 'hidden',
});
const webShellInner = (): ViewStyle => ({
  flex: 1,
  width: '100%',
  maxWidth: 1024,
  backgroundColor: colors.chrome,
  overflowX: 'hidden',
});

const appTree = (scheme: Scheme) => (
  <ErrorBoundary fallbackTitle="Solco crashed">
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <HostV3Provider>
          <BackgroundBridge>
            {/* The scheme is the key: a change remounts the screens (the Host connection above survives) so every
                color is read again; navigation state lives in the router's container and is kept. */}
            <Fragment key={scheme}>
              <TamaguiProvider config={tamaguiConfig} defaultTheme={scheme === 'dark' ? 'solcoDark' : 'solcoLight'}>
                <BottomSheetModalProvider>
                  <AppNavigator scheme={scheme} />
                  <ShareBridge />
                  <RouteNotice />
                </BottomSheetModalProvider>
              </TamaguiProvider>
            </Fragment>
          </BackgroundBridge>
        </HostV3Provider>
      </QueryClientProvider>
    </SafeAreaProvider>
  </ErrorBoundary>
);

export default function RootLayout() {
  const fontsReady = useAppFonts();
  const { appearance, hydrated } = useAppearanceStore();
  const system = useColorScheme();
  // Decided before any child renders, so no `colors` read in this pass sees the previous scheme.
  const scheme = resolveScheme(appearance, system);
  setActiveScheme(scheme);
  useEffect(() => {
    void hydrateLaunchPick(); // the Home composer's last Agent/Terminal pick, from the previous run
    void hydrateResultsSeen(); // which task-result cards were already dismissed
    void hydrateAppearance(); // System / Light / Dark, from the previous run
    void hydrateChatPrefs(); // Chat preferences (TOC outline rail)
  }, []);
  useEffect(() => {
    // Native chrome (dialogs, keyboard, pickers) follows the person's choice, not only the system's.
    Appearance.setColorScheme(appearance === 'system' ? null : appearance);
  }, [appearance]);
  const ready = fontsReady && hydrated;
  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);
  if (!ready) return null;
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.chrome }}>
      {Platform.OS === 'web' ? (
        <View style={webShellOuter()}>
          <View style={webShellInner()}>{appTree(scheme)}</View>
        </View>
      ) : (
        appTree(scheme)
      )}
    </GestureHandlerRootView>
  );
}

function AppNavigator({ scheme }: { scheme: Scheme }) {
  const router = useRouter();
  const segments = useSegments();
  const { status } = useHostV3();
  // Pairing happens on these routes; everything else needs a paired Host.
  const onPairingRoute = segments[0] === 'connect' || segments[0] === 'scan' || segments[0] === 'pair';

  // Web 标签页标题：hydration 会清空静态模板的 <title>，且清空仅发生在挂载瞬间；
  // 此处在挂载后一次性回设（PWA/标签页可读名称）。缝隙规则见 docs/web-pwa-architecture.md §2。
  useEffect(() => {
    if (Platform.OS === 'web') document.title = 'Solco';
  }, []);

  useEffect(() => {
    if (status === 'unpaired' && !onPairingRoute) {
      router.replace('/connect');
    }
  }, [status, onPairingRoute, router]);

  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          // Every page draws its own bar (components/screen): the chrome band and the rounded content card are
          // one surface that a native header cannot share, so no route shows one.
          headerShown: false,
          contentStyle: { backgroundColor: colors.chrome },
          // One platform-native push: iOS slides, Android fades up (the default fade_from_bottom is abrupt on
          // long screens); sheets carry their own springs. The Chat and New-chat screens cross-fade instead — the
          // WebView page paints late, and a fade hides that warm-up where a horizontal slide would show it.
          animation: Platform.OS === 'ios' ? 'default' : 'slide_from_right',
          animationDuration: 260,
        }}>
        <Stack.Screen name="chat/[paneId]" options={{ animation: 'fade', animationDuration: 300 }} />
        <Stack.Screen name="compose" options={{ animation: 'fade', animationDuration: 300 }} />
        <Stack.Screen name="desktop" options={{ animation: 'fade', animationDuration: 200 }} />
        <Stack.Screen name="desktop-session" options={{ animation: 'fade', animationDuration: 200 }} />
      </Stack>
    </>
  );
}
