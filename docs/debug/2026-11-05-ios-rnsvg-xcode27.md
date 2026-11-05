# iOS Xcode 27 / RNSVGFilters 部署目标构建失败：取证与修复

- 状态：**依赖配置已修复并完成 Pods 生成验证；Xcode 27 模拟器实编译待原报错机器验证**。
- 日期：2026-11-05
- 范围：Solco Mobile / Expo SDK 54 / React Native 0.81 / `react-native-svg@15.12.1`。

## 现象

用户截图的 `xcodebuild` 在 `RNSVG-RNSVGFilters`（Pods 工程）报 `IPHONEOS_DEPLOYMENT_TARGET = 12.4`，当前 Xcode 27 iOS Simulator SDK 可构建范围为 15.0–27.2.x；命令使用 `-destination 'generic/platform=iOS Simulator'`。截图来自 `/Users/caico/Documents/code/solco-mobile`；本次实际修改的工作区为 `/Users/wilson/Workspaces/wh-studio/solco-mobile`，不是截图机器的同一个检出目录。

## 根因与证据

- 项目根 `ios/` 不入 Git，Expo CNG 再生成它。生成的 `ios/Podfile` 默认 `platform :ios, ... || '15.1'`，但这**不会自动覆盖** Pods 中每个资源 bundle target 的独立最低版本。
- 修复前，`node_modules/react-native-svg/RNSVG.podspec:23` 显示 iOS/tvOS 12.4；它也声明了 `RNSVGFilters` iOS resource bundle。这与截图中失败的 target 完全对应。
- 上游已复现同一症状：<https://github.com/software-mansion/react-native-svg/issues/2992>；上游修复 PR：<https://github.com/software-mansion/react-native-svg/pull/3022>（提升最低 iOS/tvOS 部署目标至 15.1）。

## 修复

在 `pnpm-workspace.yaml` 的 `patchedDependencies` 跟踪 `patches/react-native-svg@15.12.1.patch`，同时更新 `pnpm-lock.yaml`。补丁仅把该版本 `RNSVG.podspec` 的 iOS/tvOS 12.4 改为 15.1。保留当前 Expo/RN/`react-native-svg` 版本，避免为一个 podspec 问题升级整套 SDK。**不修改被 Expo 重建的 `ios/` 和 `node_modules/` 作为永久修复。**

## 验证记录（2026-11-05）

- `pnpm exec expo prebuild --platform ios --no-install`：PASS，生成的 Podfile 主 target 默认为 15.1。
- 本机预装 CocoaPods 1.11.3：FAIL，无法解析 `react-native-safe-area-context.podspec` 的 `visionos` 字段；这是独立的本机工具链问题。使用隔离安装的 CocoaPods 1.16.2 重试。
- CocoaPods 1.16.2 `pod install`：PASS，安装 105 个 Pods。
- 用 Ruby `xcodeproj` 读取 `ios/Pods/Pods.xcodeproj`：`RNSVG-RNSVGFilters` Debug=15.1、Release=15.1；全部 Pods targets / configurations 中低于 iOS 15.0 的值：**0**。
- `pnpm install --frozen-lockfile --offline`：PASS，补丁已记录于锁文件。
- `pnpm typecheck`：PASS；`pnpm lint`：PASS；`pnpm test`：57 个文件通过、611 个测试通过（原有 1 个文件 / 2 个测试跳过）；`git diff --check`：PASS。
- 本机 `xcodebuild -workspace ios/Solco.xcworkspace -scheme Solco -configuration Debug -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build`：**环境阻塞**（Xcode 16.1 未安装 iOS 18.1 Simulator Platform），未进入源代码构建；不能声称 Xcode 27 安装成功。

## 截图机器上的复验步骤

在已收到本补丁的 `solco-mobile` 检出目录执行：

```bash
pnpm install --frozen-lockfile
# CocoaPods >= 1.16.2；旧版本无法解析部分依赖的 visionOS podspec
cd ios && pod install && cd ..
pnpm ios
```

如 Podfile/Pods 缓存仍持有旧配置，先确认 `ios/` 中没有需要保留的手工原生改动，再执行 `pnpm exec expo prebuild --platform ios --clean` 重建工程后重试。检查 `ios/Pods/Pods.xcodeproj/project.pbxproj` 中 `RNSVG-RNSVGFilters` 的部署目标为 15.1。部署到模拟器的真机同等 UI 测试、以及 Xcode 27 整体兼容性仍是未闭合门禁：若后续出现**不同 target** 的错误，应独立取证而不是视为本补丁回退。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
