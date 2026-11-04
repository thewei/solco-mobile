// [INPUT]: 依赖 expo-router/html 的 ScrollViewStyleReset，依赖 react 的 PropsWithChildren
// [OUTPUT]: 对外提供 Web 静态导出的根 HTML 模板（Expo Router +html 约定，非可导入模块）
// [POS]: src/app 的 Web-only 壳层文件——唯一允许出现 <html>/<head> 的地方；原生平台忽略此文件。
//        承载 PWA 安装元数据：manifest 链接、theme-color、apple-touch-icon（iOS 加主屏至今
//        只认这个 link，manifest icons 不够）与 apple status-bar 样式（standalone 适配）；
//        移动视口/滚动行为基线。颜色值须与 src/theme/tokens.ts 的 canvas 保持同步。
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

/**
 * PWA 元数据集中在 <head>：manifest、theme-color、apple-touch-icon、apple status-bar
 * （tokens.canvas #08090C）。viewport-fit=cover 配合原生端 edge-to-edge 基线。
 */
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover"
        />
        <link rel="manifest" href="/manifest.json" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
        <meta name="theme-color" content="#08090C" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <title>Solco</title>
        {/* 本版 expo-router 的 ScrollViewStyleReset 为零 props 的 style 注入，按其官方 Html 同型置于 head */}
        <ScrollViewStyleReset />
      </head>
      <body>{children}</body>
    </html>
  );
}
