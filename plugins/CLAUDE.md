# plugins/
> L2 | Parent: ../CLAUDE.md

Members:
- `with-ios27-scene-lifecycle.js` — Expo SDK 54 的临时 CNG iOS 插件：在生成的 AppDelegate.swift 中接入 UIWindowScene、配置 Info.plist、保留 Expo AppDelegate deep links/场景状态；升级 SDK 58 后移除。
- `with-ios27-scene-lifecycle.test.ts` — 静态验证启动窗口移交、冷/热链接转发、幂等与 SDK 模板漂移拒绝。
- `with-libghostty-ndk.js` (+ `.test.ts`) — 给 `:expo-libghostty` 模块传入根工程的 `ndkVersion`（库自己不设，AGP 回落到默认 NDK 27.0.12077973，未安装即 CXX1101）；库修复后移除。
- `with-libghostty-ios-target.js` (+ `.test.ts`) — 把 iOS 部署目标提到 16.4（Podfile 与 App target）：expo-libghostty 的 podspec 要求 16.4，SDK 54 默认 15.1 时 Expo 自动链接会静默丢掉该 pod 而 `ExpoModulesProvider` 仍 import，导致编译失败；提高最低系统是产品决策，仅存在于终端渲染器实验分支。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
