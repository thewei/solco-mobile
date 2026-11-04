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
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform, View, type ViewStyle } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { TamaguiProvider } from 'tamagui';

import { ErrorBoundary } from '@/components/error-boundary';
import { RouteNotice } from '@/components/route-notice';
import { BackgroundBridge } from '@/features/host/background-bridge';
import { ShareBridge } from '@/features/share/share-bridge';
import { HostV3Provider, useHostV3 } from '@/lib/host-v3-provider';
import { hydrateLaunchPick } from '@/state/session-store';
import { colors } from '@/theme/tokens';
import { tamaguiConfig } from '../../tamagui.config';

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
// 四边 0 绝对定位锚定视口，补齐导出 HTML 无高度链的问题。
const webShellOuter: ViewStyle = {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  flex: 1,
  alignItems: 'center',
  backgroundColor: colors.canvas,
  overflowX: 'hidden',
};
const webShellInner: ViewStyle = {
  flex: 1,
  width: '100%',
  maxWidth: 1024,
  backgroundColor: colors.canvas,
  overflowX: 'hidden',
};

const appTree = (
  <ErrorBoundary fallbackTitle="Solco crashed">
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <HostV3Provider>
          <BackgroundBridge>
            <TamaguiProvider config={tamaguiConfig} defaultTheme="solcoDark">
              <BottomSheetModalProvider>
                <AppNavigator />
                <ShareBridge />
                <RouteNotice />
              </BottomSheetModalProvider>
            </TamaguiProvider>
          </BackgroundBridge>
        </HostV3Provider>
      </QueryClientProvider>
    </SafeAreaProvider>
  </ErrorBoundary>
);

export default function RootLayout() {
  useEffect(() => {
    void hydrateLaunchPick(); // the Home composer's last Agent/Terminal pick, from the previous run
  }, []);
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.canvas }}>
      {Platform.OS === 'web' ? (
        <View style={webShellOuter}>
          <View style={webShellInner}>{appTree}</View>
        </View>
      ) : (
        appTree
      )}
    </GestureHandlerRootView>
  );
}

function AppNavigator() {
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
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          contentStyle: { backgroundColor: colors.canvas },
          headerStyle: { backgroundColor: colors.canvas },
          headerTintColor: colors.text,
          // One platform-native push: iOS slides, Android fades up (the default fade_from_bottom is abrupt on
          // long screens); the drawer and sheets carry their own springs. The Chat and New-session screens
          // cross-fade instead — their bodies grow out of the tapped composer card (`ZoomIn`), so a
          // horizontal slide would fight the zoom.
          animation: Platform.OS === 'ios' ? 'default' : 'slide_from_right',
          animationDuration: 260,
        }}>
        <Stack.Screen name="(home)" options={{ headerShown: false }} />
        <Stack.Screen name="connect" options={{ title: 'Connect to your computer', headerBackTitle: 'Back' }} />
        <Stack.Screen name="scan" options={{ title: 'Scan QR code', headerBackTitle: 'Back' }} />
        <Stack.Screen name="pair" options={{ title: 'Pairing', headerBackVisible: false }} />
        <Stack.Screen name="chat/[paneId]" options={{ headerShown: false, animation: 'fade', animationDuration: 300 }} />
        <Stack.Screen name="changes/[workspaceId]" options={{ title: 'Changes', headerBackTitle: 'Back' }} />
        <Stack.Screen name="changes/diff" options={{ title: 'Diff', headerBackTitle: 'Changes' }} />
        <Stack.Screen name="files/[workspaceId]" options={{ title: 'Files', headerBackTitle: 'Back' }} />
        <Stack.Screen name="files/view" options={{ title: 'File', headerBackTitle: 'Files' }} />
        <Stack.Screen name="compose" options={{ headerShown: false, animation: 'fade', animationDuration: 300 }} />
        <Stack.Screen name="automations/index" options={{ title: 'Automations', headerBackTitle: 'Back' }} />
        <Stack.Screen name="automations/[name]" options={{ title: 'Automation', headerBackTitle: 'Automations' }} />
        <Stack.Screen name="automations/edit" options={{ title: 'Automation', headerBackTitle: 'Back' }} />
        <Stack.Screen name="automations/ask" options={{ title: 'Let an Agent Draft', headerBackTitle: 'Back' }} />
        <Stack.Screen name="assistants/index" options={{ title: 'Chats', headerBackTitle: 'Back' }} />
        <Stack.Screen name="assistants/[id]" options={{ title: 'Assistant', headerBackTitle: 'Assistants' }} />
        <Stack.Screen name="assistants/new-group" options={{ title: 'New Group', headerBackTitle: 'Assistants' }} />
        <Stack.Screen name="assistants/group/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="assistants/style/[id]" options={{ title: 'Work style', headerBackTitle: 'Assistant' }} />
        <Stack.Screen name="assistants/approvals" options={{ title: 'Needs You', headerBackTitle: 'Assistants' }} />
        <Stack.Screen name="desktop" options={{ headerShown: false, animation: 'fade', animationDuration: 200 }} />
        <Stack.Screen name="desktop-session" options={{ headerShown: false, animation: 'fade', animationDuration: 200 }} />
        <Stack.Screen name="share" options={{ title: 'Share to Solco', headerBackTitle: 'Back' }} />
        <Stack.Screen name="terminal/[terminalId]" options={{ title: 'Terminal', headerBackTitle: 'Back' }} />
      </Stack>
    </>
  );
}
