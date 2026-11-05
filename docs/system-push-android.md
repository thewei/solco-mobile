# Android 系统级后台推送

Solco Android 的前台服务 + WebSocket + 本地通知依赖手机 JS 进程。新增的系统推送走 Mac Host → Expo Push Service → Google FCM，应用进程退出后仍可以由 Android 系统接收。两条路径共用同一 Assistant Activity 事实账本、设备通知游标，但与用户明确的“Mark seen”游标隔离。

## 用户设置

1. 在 Expo 创建 EAS Project、在 Firebase 创建与 com.whstudio.solco.mobile 包名一致的 Android App，取得 Expo Project UUID 与 google-services.json。通过 EAS credentials 将 FCM v1 的服务账号凭证上传 Expo；绝不要把私钥放到这个 App/仓库。完整步骤参见 Solco Mac 仓库 docs/debug/2026-11-05-assistant-system-push.md。
2. 构建包含上述配置的 Android 开发/正式安装包，不能使用 Expo Go。通过 Mac Solco 完成配对，确保 Mac Host 开启且可上网。
3. 手机 Connection → System push when app is closed → Enable system push，授权系统通知。只有显式启用才向当前配对 Mac 上传 Expo Token。
4. 点 Send a system push test，锁屏确认 Android 收到通知。接口的 queued 仅代表 Expo 接收请求，不代表手机已经收到或显示。
5. 让 App 进程关闭、原 Socket 断开；在 Mac 触发 Assistant 新 Task/Approval/OMP report Activity，确认系统通知到达。点击可冷启动并打开对应 Activity History。
6. Disable system push 删除当前 Mac 上该配对设备的 Token；Token 轮换不能重新启用。Mac 撤销设备配对也会清除 Token。

## 构建变量

- EXPO_PUBLIC_EAS_PROJECT_ID：Expo 项目 UUID，用于 Expo SDK 项目识别。
- SOLCO_GOOGLE_SERVICES_FILE：Android 客户端 google-services.json 的本地绝对路径。该文件须与构建的包名一致。
- Firebase FCM v1 服务账号私钥上传至 Expo/EAS Credentials，而不是 Android 安装包或 Mac Host。Mac 仅持有设备 Push Token；启用 Expo Enhanced Push Security 的项目可以在 Mac Host 通过 Options.PushAccessToken 传入单独的 Expo access token。

## 限制与安全

- 无 Google Play Services 的国行 vivo/OriginOS ROM 可能收不到 FCM：继续使用前台服务和本地通知；App 被强杀后该兜底无法保证接收。后续需有资质的厂商推送。
- Mac 必须开机、Solco Host 正在服务且 Mac 网络可达 Expo；Mac 睡眠/关机或 Host 不运行就没有主动系统推送。iOS APNs 尚未接入。
- Expo ticket、FCM receipt、真实设备通知展示、人工已读是四个不同状态。系统仅在确认 FCM/APNs receipt 后 ACK 通知游标，不宣称用户实际看过。丢失 receipt 时采用有界重试，可能重复通知。
- 对 Expo/FCM 只提供 Token、泛化锁屏状态以及不透明 Assistant ID 的 Activity 路由；不包括任务名称、用户提示词、审批细节、证据、文件路径或 OMP 转录。未配置 EAS/FCM 的安装包 UI 会明确说明不可启用。

## 本地验证

在手机仓库执行 pnpm sync:fixtures、pnpm check:fixtures、pnpm typecheck、pnpm lint、pnpm test、pnpm check:chat-page。真正的系统级后台送达仍必须在配置凭证后通过有 Google 服务的 Android 真机或兼容模拟器验收。
