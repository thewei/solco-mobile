# Xcode 27 / iOS 27 启动闪退：UIScene 生命周期兼容调查

- 日期：2026-11-05
- 状态：**源码及 CNG 验证通过；iOS 27 编译/模拟器启动/实机行为验收仍阻塞**
- 工程：`solco-mobile`，Expo SDK 54.0.37 / React Native 0.81.5 / Expo Router 6.0.24。
- 独立于 `2026-11-05-ios-rnsvg-xcode27.md` 中的 CocoaPods 12.4 构建失败：修复后依然可能编译成功但启动闪退。

## 一、可确认的根因与触发边界

Apple 规定**使用 iOS 27 SDK 构建**的 App 必须采用 UIKit `UIScene` 生命周期，否则启动时发生 `SIGTRAP`，典型符号 `_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption`。在 Xcode 26 及更早版本的 SDK 上测试成功，不能推导 Xcode 27 构建可用。

- 官方规范：<https://developer.apple.com/documentation/uikit/transitioning-to-the-uikit-scene-based-life-cycle>
- React Native 上游报告：<https://github.com/facebook/react-native/issues/58545>
- Expo 上游与 workaround 实测：<https://github.com/expo/expo/issues/50179>
- 同 Expo 54.0.37 / RN 0.81.5 的启动与 Expo Router 深链接经验：<https://jonahdevs.com/posts/expo-ios-27-uiscene-crash/>
- Expo SDK 58 官方原生支持及迁移说明：<https://expo.dev/changelog/sdk-58>、<https://github.com/expo/fyi/blob/main/ios-scene-lifecycle.md>

变更前在本仓库通过 Expo CNG 生成的 `ios/Solco/AppDelegate.swift` 仍在 `application(_:didFinishLaunchingWithOptions:)` 中使用 `UIWindow(frame: UIScreen.main.bounds)` 和 `factory.startReactNative(...)`；`Info.plist` 没有 `UIApplicationSceneManifest`。因此**已确定存在官方描述的高风险配置**，但没有在当前机器拿到 iOS 27 本地 crash trace，不把上游复现冒充本地复现。

## 二、修复策略（临时、绑定 Expo SDK 54）

- `plugins/with-ios27-scene-lifecycle.js` 通过 Expo config plugin 注入 `UIApplicationSceneManifest` 和 Swift `SolcoSceneDelegate`；单窗口场景。
- `AppDelegate` 保留 Expo/RN 工厂初始化，但由连接中的 `UIWindowScene` 创建窗口、设置 `AppDelegate.window`，然后启动 RN（避免仅添加 manifest 造成黑屏）。
- 冷启动 `connectionOptions.urlContexts`、Universal Link `userActivities`、暖启动 URL/userActivity 回到 `ExpoAppDelegate`，经过现有 Expo subscribers 与 RN 路由，不额外直接触发第二个 `RCTLinkingManager`；保留 RN 的 `launchOptions`，并转发场景前后台回调。
- 修改以 `app.config.ts` 的 CNG plugin 跟随 `prebuild`，不维护或提交生成的 `ios/`；支持重复运行 prebuild。如果 Expo Swift 模板变化则在预构建时主动失败，不静默输出黑屏产物。
- **升级到 Expo SDK 58 时必须移除**该兼容插件，由 Expo 官方 UIScene 实现接管；不应在 SDK 54 上单独搬 SDK 58 的 Expo SceneDelegate。

## 三、验证（当前开发机）

环境：macOS 15.6.1 + Xcode 16.1，安装的 iOS Simulator runtimes 和设备列表为空，磁盘可用约 13 GiB；Xcode 27 官方要求 macOS Tahoe 26.6+，不适合在此主机安装 Xcode 27。

- 原项目 Expo 54 的 CNG 输出确认旧式 `UIWindow(frame:)` + 无 scene manifest：**已确认（failing source evidence）**。
- `CI=1 pnpm exec expo prebuild --platform ios --clean --no-install`：**PASS**。
- `CI=1 pnpm exec expo prebuild --platform ios --no-install`：**PASS**（重复生成幂等）。
- 生成 `ios/Solco/Info.plist`：存在正确 `UIApplicationSceneManifest`，Delegate class 为 `$(PRODUCT_MODULE_NAME).SolcoSceneDelegate`：**PASS**。
- 生成 `ios/Solco/AppDelegate.swift`：场景内 `UIWindow(windowScene:)`、RN factory 启动、冷/热链接转发、前后台回调：**PASS**。
- `xcrun swiftc -frontend -parse ios/Solco/AppDelegate.swift`：**PASS**；用本机 iOS 18.1 Simulator SDK 独立 `swiftc -typecheck` 检查 UIKit 的场景委托回调：**PASS**（都不等于完整 App 编译）。
- `pnpm typecheck`：**PASS**；`pnpm lint`：**PASS**；`pnpm test`：**PASS**（614 passed、2 skipped）；`git diff --check`：**PASS**。
- `xcrun simctl boot 'iPhone 16'`：**BLOCKED**，`Invalid device or device pair`；`xcrun simctl list runtimes` 和 available devices 都为空。没有安装、启动 iOS 27 模拟器，**不能声称在 iOS 27 上不再闪退**。

## 四、需要在拥有 Xcode 27 的 macOS 26.6+ 环境执行的验收

按顺序逐项记录设备、SDK、构建和运行日志：

1. `pnpm install --frozen-lockfile`；`pnpm exec expo prebuild --platform ios --clean`；确认 Pods target `RNSVG-RNSVGFilters` Debug/Release >= 15.0。
2. 运行 `pnpm exec expo run:ios --device 'iPhone 18 Pro'`（以该 Xcode 实际安装的模拟器设备名为准），验证原生 build、app install 和 `simctl launch` 成功。
3. 从桌面冷启动：启动画面显示、首页实际渲染、无 `_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption`、无启动后黑屏。
4. 冷启动 `solco://pair?...` 和 App 前台时的第二次 URL：进入正确配对路由；再验证 Universal Link（若已配置）；敏感 pairing URL **不可贴进公开日志**。
5. 后台→前台、系统通知点击→对应消息、切换页面/Remote Connection、强制退出→再打开、反复启动十次；检查 AppState/推送/SceneDelegate 日志。
6. 对照 Xcode 26 / iOS 26 设备检查兼容性回归，尤其注意 iOS 27 的窗口尺寸、旋转和原生模块行为。

任何后续新 crash 必须记录设备 crash symbol/stack、Swift/ObjC 异常、EXC_BAD_ACCESS 或 abort 位置，区分 UIScene SIGTRAP 与原生模块其他问题。此次仅解决已知的启动生命周期缺口，**不是 Expo SDK 54 在 iOS 27 的完整认证**。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
