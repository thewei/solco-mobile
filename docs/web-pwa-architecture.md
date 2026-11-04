# Solco Mobile Web / PWA Architecture

> 定位：Solco Mobile 的 Web/PWA 表面架构。回答「Web 端是什么、不是什么、平台缝隙如何处理」。
> 父级：`docs/mobile-product-architecture.md`（总架构）· 依赖事实：`docs/implementation-roadmap.md`（W 里程碑）
> 跨仓对齐：solco 仓库 `docs/remote-client-architecture.md`（Host 侧拓扑与传输决策）

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

## 1. Web 端的身份

**Web 不是第四个产品，是同一个手机客户端的编译目标。**

- 同一棵 Expo Router / Tamagui / Gorhom Bottom Sheet React Native 树，经 `react-native-web` 编译为 DOM（`pnpm export:web`，静态产物）。
- 样式与交互完全遵循 `docs/mobile-ui-ux.md` 的手机契约；桌面浏览器不做响应式分叉，只做「居中手机宽度容器」的外壳处理。
- Web 的使命按顺序：(1) 技术栈验证（RN 树在 DOM 上的真实手感）；(2) Host API 最快的联调夹具；(3) 零安装的 PWA 入门路径。

事实基线（2026-08-24 实测）：`pnpm export:web` 全绿，`dist/` 产出完整（index / connect / agent 路由）。首跑约 7 分钟（React Compiler + Tamagui 编译慢），日常开发用 `expo start --web` 热更，export 仅作发布验证。

事实基线（2026-08-30）：Mac 侧仍保留认证 WS 与 v1 兼容控制端点；语义 Conversation/History 客户端已切换到 Remote API v2（hello/bootstrap、Conversation list/window/prompt/continue），shared/global Herdr TUI 由 Host 单实例路由承载（Host 已实现并声明 `herdr_tui=true`；运行时/原生 VT 验证仍是发布门槛）。旧 Terminal 面板走查仅是历史证据，不代表当前产品路径。

## 2. 平台缝隙规则（唯一允许的 Platform.OS === 'web' 分叉点）

Web 与原生共享全部业务代码，平台差异收敛在以下缝隙，新增缝隙必须先落本表：

| 缝隙 | 规则 |
|------|------|
| 连接持久化 | `baseUrl` 与 `credential` 都落 `localStorage`（2026-08-31 产品决策：页面刷新不丢连接；局域网工具接受 Web 端 localStorage 的暴露面）。唯一边界 `src/lib/host-connection.ts`，native 仍走 SecureStore 加密存储 |
| 凭据入口 | Web 连接屏不显示「记住凭据」类选项；credential 只在当前会话输入 |
| 安装体验 | manifest + 图标走 PWA；service worker 明确不做（见 §5） |
| 视口外壳 | 桌面浏览器以手机宽度居中容器呈现，背景用 canvas 色；不新增桌面布局代码 |

`src/lib/host-connection.ts` 是连接持久化的唯一边界，Web 分叉只允许存在于该文件内部。

## 3. Wire 命名契约

**wire = snake_case，内部 = camelCase，转换只发生在 `src/contracts/` 一处。**

- Host（Rust serde）零 rename 面：DTO 保持 `project_id` / `agent_id` 原样上 wire。
- Zod schema 在 contracts 层以 `transform` 把 wire 字段映射为内部 camelCase，屏幕/组件只见 camelCase。
- 禁止在 adapter、屏幕、mock 里散落第二个转换点；禁止为迁就客户端让 Host 加 rename 属性。

## 4. 目标拓扑：Host 伺服 Web 静态包

开发回路与目标拓扑分离：

```text
开发（W0–W2）:
  浏览器(localhost:8081) ──CORS(dev 白名单)──▶ Axum loopback(127.0.0.1:8787)/api/v2
                                              └─ Solco Host services ─▶ Herdr

目标（W4 / R8 窗口）:
  手机 ──HTTPS(Tailscale cert)──▶ 同一 Axum ─┬─ ServeDir(dist/)  静态 Web 包
                                             └─ /api/v2           同源语义 API（v1 仅兼容控制）
  同源 ⇒ CORS 归零 ⇒ manifest 可安装 ⇒ PWA
```

- Web 静态包最终由 Mac Host 伺服（code-server / Syncthing 成熟模式），不新增独立 Web 部署设施。
- 该拓扑落地前，Web 联调走 dev CORS 白名单（仅回环开发，见 solco 仓库 `docs/remote-client-architecture.md`）。
- LAN 裸 IP 是非安全上下文：PWA 安装、service worker 注册均不可用——安装类验收一律走 Tailscale HTTPS，这是硬约束不是偏好。

## 5. PWA 边界

**做**：web manifest（standalone、`#08090C` 主题色）、图标（含 maskable）、移动端安装体验。

**明确不做（当前阶段）**：
- service worker / 离线壳——安装不需要 SW，离线缓存是硬化期课题（YAGNI）；
- 桌面响应式布局分叉；
- Web 独有的导航或交互差异。

PWA 阶段的已知负担：`/agent/[agentId]` 静态页 ~8.5 MB。验证期不阻塞；硬化期若要优化，方向是路由级代码分割，不在本架构内展开。

## 6. 事件流语义（Web 阶段）

WebSocket 事件是优化不是真相源（继承 `mobile-product-architecture.md` §7）。W2 联调阶段用 TanStack Query 轮询兜底，`refetchInterval` 即可满足验证；WebSocket 事件客户端仍留在 M1 剩余项，不因 Web 提前。

## 7. 决策摘要

| 决策 | 结论 | 理由 |
|------|------|------|
| Web 定位 | 同一 RN 树的编译目标 | 单一交互契约，零分叉熵 |
| wire 命名 | snake_case，contracts 层单点转换 | Host 零 rename 面，转换点唯一可审计 |
| credential 持久化 | Web 禁止，内存会话 | 无 SecureStore 等价物，密钥落盘即违规 |
| PWA 安装路径 | Tailscale HTTPS | 非安全上下文硬约束 |
| service worker | 不做 | 安装不需要，YAGNI |
| 最终部署 | Host 伺服 dist/ | 同源消 CORS，零新增运行时 |
