# Solco Mobile Web Implementation Plan

> 定位：Web/PWA 验证的实施顺序、验收门与步骤清单。架构依据：`docs/web-pwa-architecture.md`。
> 跨仓协调：W1 依赖 solco **R6 loopback Remote API（进行中）**——本仓不定义 R6，只消费其最小纵切。
> 纪律：mobile UI 不得超前 Host gates（solco 仓库 P6 里程碑纪律）。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

## 阶段总览

| 阶段 | 仓库 | 依赖 | 独立可合并 |
|------|------|------|-----------|
| W0 Web 平台缝隙 | solco-mobile | 真实 Host 连接配置 | ✅ |
| W1 R6 最小纵切联调门 | solco | R6（进行中） | ✅ 属 R6 交付物 |
| W2 Web ↔ 真 Host 联调 | solco-mobile | W1 | ✅ |
| W3 PWA 层 | solco-mobile | W2（安装验收需真 Host 可达） | ✅ |
| W4 Host 伺服 Web 包 | solco | W3、R8 窗口 | ✅ |

每阶段合并后系统处于可用状态；任一阶段停摆不阻塞已合并阶段。

---

## W0 — Web 平台缝隙

**目标**：Web 上真实 Host 连接可用、可刷新恢复、手感可信。

**工作项**
- `src/lib/host-connection.ts`：Web 分支改为 baseUrl → `localStorage`，credential → 内存模块级变量（仅当前会话）；读写/清除 API 签名不变。
- 连接屏：Web 上 credential 输入区标注「会话内有效」；不提供记住选项。
- 桌面外壳：`src/app/_layout.tsx` 层面以 Platform 分叉包一层手机宽度居中容器（max-width ≈ 430px，canvas 背景填充），不改屏幕代码。
- 全屏走查清单：Agent Board 分组渲染 / Bottom Sheet 开合 / Agent 详情导航 / Connect → real Host 流。

**验收**
- `pnpm export:web` 绿；`expo start --web` 热更回路可用。
- 刷新后连接配置保留（baseUrl），credential 不残留（DevTools → Application 可证）。
- Bottom Sheet 在 web 上开合、拖拽、 backdrop 表现正常（Reanimated web 为纯 JS 实现，官方支持；此项为质量验证非阻塞）。

**风险**：8.5 MB 静态页加载慢——验证期接受，记录不修。

---

## W1 — R6 最小纵切联调门（solco 仓）

**目标**：进行中的 R6 loopback API 提供本计划所需的最小命令面。

**本仓只需以下端点可用**（语义边界已在 solco 仓库 `docs/remote-client-architecture.md` §8 定义）：

```text
GET  /api/v1/hello
GET  /api/v1/bootstrap
GET  /api/v1/agents/{agent_id}
POST /api/v1/agents/{agent_id}/prompt
```

**对 R6 的约束（写入 solco 仓库侧文档，此处引用）**
- wire 命名 snake_case（serde 默认，零 rename）。
- CORS dev 白名单：仅 `--dev-remote-origins` 显式 flag 打开，默认空；白名单只接受开发源（`http://localhost:8081`）。
- 监听仅 127.0.0.1；无鉴权阶段所有响应头携带显式 `X-Solco-Dev-Api: 1` 便于审计。

**验收**（在 solco 仓执行）
- curl 四端点全通；非回环绑定被拒。
- 隔离 Herdr 实例上 prompt 往返成功（冒烟会消耗少量模型额度——运营决策点，需明确批准后执行）。

**风险（最脆弱假设）**：真实 `agent.start/prompt` 冒烟会消耗模型额度；若 Host 未运行或额度未批准，联调应明确记为阻塞，不得用假数据替代。

---

## W2 — Web ↔ 真 Host 联调

**目标**：浏览器里对真 Agent 发 prompt 并读回输出。

**工作项**
- `src/contracts/host.ts`：Zod schema 增加 wire→内部 transform（snake_case→camelCase），单点转换。
- `HttpHostClient`：对齐 W1 端点路径；wire 命名随契约层自动正确。
- 事件兜底：bootstrap/agent query 挂 `refetchInterval`（bootstrap 10s / agent 详情 3s，working 态），标注 TODO(r6-events) 待 WebSocket 客户端（M1 剩余项）替换。
- 本地地址：`.env` 的 `EXPO_PUBLIC_SOLCO_HOST_URL` 指向真实 Host（默认 Remote 端口 `8757`，具体以 Solco Mobile 设置为准）。

**验收**
- 浏览器（手机视口）完成：连接 → 选 Workspace/Project → 进 Agent → 发 prompt → 轮询看到输出/状态变化。
- 故意打错端口/停 Host：错误显式呈现，恢复后 refetch 自愈，无永久漂移。

---

## W3 — PWA 层

**目标**：Web 包成为可安装的 PWA。

**工作项**
- `app.config.ts`：`web` 段补 manifest（name Solco、standalone、theme/background `#08090C`）。
- `public/`：图标 192/512（含 maskable）；favicon。
- 安装验收环境：Tailscale HTTPS（LAN 裸 IP 为非安全上下文，manifest 安装不可用——硬约束）。

**验收**
- 手机经 `https://<mac>.ts.net`（W4 前可临时用任意 HTTPS 反代伺服 dist/）触发「添加到主屏幕」，独立窗口启动，主题色正确。
- 杀进程重开：resume 后重连 Host、状态不漂移。

---

## W4 — Host 伺服 Web 包（solco 仓，R8 窗口）

**目标**：Axum `ServeDir` 挂 mobile `dist/`，同源消 CORS，成为零配置手机入门路径。

**约束**：solco-mobile `pnpm export:web` 产物作为构建输入接入 Solco.app 打包流程；静态资源路径需与 Expo Router 静态导出的 asset 前缀一致。详细归属 solco 仓库 `docs/remote-client-architecture.md`（Host-served web 小节）。

---

## W-polish — UI/UX 契约合规修复（2026-08-24 审计落地）

**目标**：消除实现与 `mobile-ui-ux.md` 的违背项 + 移动端基本功，零 Host 新依赖。

**审计裁决依据**：卡片pane_id泄露/死按钮/无下拉刷新/无折叠/无骨架/等宽字体/apple-touch-icon 等（见对话审计）。契约缺口（AgentSummary 无 `updated_at`/summary → 卡片 freshness 无法实现）记为 solco R6 DTO 演进项，不在本仓伪造。

**范围**：
- A 板块簇：`agent-card.tsx`（去 pane_id；副标题 project·kind；title 作 summary 行）+ `index.tsx`（下拉刷新、IDLE 区、DONE/IDLE 默认折叠+计数、分区头状态色、搜索过滤、Plus 诚实禁用、徽章 ChevronRight、骨架卡片）
- B 详情簇：`[agentId].tsx`（Stop 诚实禁用、keyboardVerticalOffset 实测化、web 等宽字体、Terminal follow-latest+回到底部、HostRequestError 人话展示）+ `queries.ts`（output 查询仅在真实 Host 连接后启用，未配置时不发空请求）
- C 周边簇：`workspace-picker.tsx`（BottomSheetScrollView + 本地搜索 + 选工作区后滚到 PROJECTS）+ `connect.tsx`（Android 提示仅 Android 显示）+ `+html.tsx`（apple-touch-icon + status-bar-style）

**明确不做**：New Agent composer（无 start API）、interrupt 接线（无端点）、freshness（无契约字段）、桌面响应式分叉。

---

## W-engage — 现有端点面的交互升级（2026-08-25）

**目标**：在 R6 现有端点面（hello/bootstrap/agents/output/prompt+wait_until/events-WS，无 interrupt/start/conversation）内把手机端价值掉满，零新 Host 依赖。

**裁决依据**：`agent.updated` 事件载荷携带 `status/project_id`（events.rs 实证）→ 阻塞跃迁可在 bridge 本地检测；conversation 端点未落前，Chat 的 output timeline 只能做有界尾随块（契约诚实）；wait_until 会悬挂 mutation（TanStack 长时间 pending），本轮不用，通知走事件桥。

**范围**：
- 详情屏：Chat 尾部 LIVE ACTIVITY 块（useAgentOutput 有界尾随+自动更新+Open Terminal 跳转）、快捷指令 chips（填入不代发）、per-agent 会话级草稿、状态彩色 pill、Terminal 复制（web）
- 连接面：board 铃铛（web，Notification.permission）、events bridge 检测 →blocked 跃迁 + document.hidden → 本地通知；状态存 session-store（无新持久化缝隙）

**明确不做**：真对话时间线/interrupt 接线/New Agent（等 Host 端点）；原生推送（需 expo-notifications + dev build 重建，记为后续）；wait_until 通知（会悬挂 mutation，事件桥更诚实）。

---

## W-terminal — Pane Terminal 与 Terminals 导航（2026-08-25，历史记录）

> This phase records the pre-convergence experiment. It is superseded by the 2026-08-30
> Conversation/TUI boundary: `TerminalsSection` is removed from normal IA, `/pane/[paneId]` is
> diagnostic-only behind an explicit flag, and a real global Herdr TUI is now implemented through
> the Host-owned shared lifecycle (`herdr_tui=true` in the source contract; live operator and native
> VT verification remain open).
> The historical screenshots and checks below must not be
> read as current TUI support.

**目标**：首页展示当前项目的全部 Tab/Pane，点击进入独立 Pane Terminal 页面，支持终端 I/O。

**范围**：
- 首页 TERMINALS 折叠区：按 Tab 分组展示 pane 列表，Agent pane 显示 agent 名称+kind 标签+状态色，非 Agent pane 显示终端标题+cwd
- Pane Terminal 详情页：wterm 渲染 ANSI 输出 + 键盘输入 + 复制
- Remote Control 树形视图：workspace → tab → pane 完整层级 + 操作按钮
- Remote API 扩展：`getPaneOutput`/`sendPaneKeys` + P0/P1 全部端点（workspace/tab/pane/agent CRUD）
- `serve-web.mjs` 动态路由支持

**验收**：
- ego-browser 截图确认 TERMINALS 区正确展示 7 个 pane（按 Tab 分组）
- Pane Terminal 页面 wterm 正确渲染真实终端 ANSI 输出
- `pnpm typecheck && pnpm lint && pnpm export:web` 全绿

**已知问题**：Mac App 在通过 Remote API 触发 `create_tab`/`split_pane` 时 GPUI 事件reconciliation 崩溃——标记为已知问题，不阻塞 Mobile。

---

## 步骤清单（执行序）

### W0（solco-mobile）
- [x] `src/lib/host-connection.ts` — Web 分支：baseUrl→localStorage、credential→会话内存；保持 API 签名（2026-08-24，含 SSR/隐私模式防御）
- [x] `src/app/connect.tsx` — Web 上 credential 输入区「会话内有效」标注（替换原 SecureStore 文案，避免虚假陈述）
- [x] `src/app/_layout.tsx` — 桌面手机宽度居中外壳（Platform 分叉；绝对定位四边 0 锚定视口，避开 RN 类型不含 100vh）
- [x] 走查：board 分组 / sheet 开合 / agent 详情 / connect→demo（2026-08-24 历史原型记录；Demo 路径已于 2026-08-31 退役，当前验收必须连接真实 Host）
- [x] `pnpm typecheck && pnpm lint && pnpm export:web` — 全绿（2026-08-24；doctor 1 warning）
- [x] 验收：刷新保留 baseUrl、credential 不残留（DevTools Application 面板核验）（2026-08-24 ego-browser 实测，见下方走查记录）

W0 历史走查记录（2026-08-24，ego-browser 实测，静态 dist + 390/844 移动视口；仅供回归参考，Demo 路径已退役）：
- 连接门/重定向、Connect 屏（含 Session only 提示）、历史 Demo 进入、三分组 board、BottomSheet 开合与工作区/项目切换（board 重投影生效）、agent 详情（Chat/Terminal tab + Stop + prompt 输入）、prompt 发送后 board summary 同步更新——全部通过；
- 安全边界：失败连接后 localStorage 完全为空（validation-before-persist 实证）；存 baseUrl 后刷新留 remote 模式；清除后回 connect 门；无 unhandled rejection；
- 走查中修复：web hydration 清空静态 `<title>`，`_layout.tsx` AppNavigator 挂载后一次性回设 `document.title`（web-only）；
- 几何/视觉：桌面 1440 视口下唯一 maxWidth 430 容器居中（x=505），移动 390 视口无横向溢出，字体栈 Inter/system-ui 合规（20/15/11px 层级）；
- 截图：`/tmp/solco-walkthrough-mobile-390.png`。

### W-polish（solco-mobile）
- [x] A：卡片去 pane_id、project·kind 副标题、title summary 行（2026-08-24，ego-browser 实证 pane 泄露清零）
- [x] A：下拉刷新、IDLE 分区、DONE/IDLE 折叠+计数、分区头状态色（NEEDS YOU=amber / WORKING=indigo 实测）
- [x] A：搜索过滤、Plus 禁用态、徽章 ChevronRight、骨架卡片（surfacePressed 色块，克制于 §3）
- [x] A：过滤激活时强制展开折叠分区（走查发现过滤命中被折叠藏住的缺陷，热修：`!normalizedFilter && collapsed`）
- [x] B：Stop 禁用态、keyboard offset 实测（useHeaderHeight 不可达于 pnpm 严格布局，保留 92+注释）、web 等宽、follow-latest+Latest pill、Chat 贴底
- [x] B：output 查询与 HostRequestError 展示（message+code；历史 Demo 适配已移除）
- [x] C：sheet BottomSheetScrollView+搜索+滚动定位、Android 提示限定 android、apple-touch-icon+status-bar-style
- [x] `pnpm typecheck && pnpm lint && pnpm export:web` 全绿（含一处 typecheck 修复：placeholderTextColor 用 token $placeholderColor）
- [x] ego-browser 走查复验（分区色/卡片重构/折叠展开/sheet 搜索过滤/项目切换/board 过滤+计数；截图已留档）

复验注记：BottomSheetTextInput（Android 焦点边缘）与 apple-touch-icon 180px 理想尺寸留待原生/品牌走查；契约缺口 freshness（AgentSummary 无 updated_at）已记 solco R6 DTO 演进项。

### W-engage（solco-mobile）
- [x] 详情：Chat LIVE ACTIVITY 尾随块（末 8 行等宽输出+Open Terminal 跳 tab；60s 轮询+事件失效自动更新）（2026-08-24 实证）
- [x] 详情：快捷指令 chips（填入草稿不代发；实测点 Continue→草稿入字）、per-agent 会话草稿防丢（实测返回再进不丢）
- [x] 详情：状态彩色 pill、Terminal 复制（web；28px 圆钮+图标反馈）
- [x] 连接面：铃铛（web）+ bridge →blocked 跃迁检测 + hidden 通知；session-store 状态（bridge 通知逻辑五重守卫；浏览器通知弹出属人工验收）
- [x] `pnpm typecheck && pnpm lint && pnpm export:web` 全绿（含一处 ref 类型修复：TamaguiElement 挂点+单点 focus 收窄）
- [x] ego-browser 走查复验（chips/草稿/LIVE OUTPUT/tab 跳转/等宽字体/复制钮）

复验注记：Tamagui Button 在 web 不转发 accessibilityLabel→aria-label（DOM 无 label 属性，代码已设；原生正常）——记为后续 a11y 议题；Input 原生端 focus() 行为待原生走查；通知冷启动语义（连接瞬间已知 blocked 也会通知）按规格接受。

## W1（solco，与 R6 并行推进方协调）
- [ ] R6 侧确认四端点 + snake_case wire + dev CORS flag + `X-Solco-Dev-Api` 头
- [ ] curl 冒烟四端点
- [ ] 隔离实例 prompt 往返（**需额度批准**；被阻则启用 W2 降级开关）

### W-terminal（solco-mobile + solco）
- [x] solco: Remote API P0/P1 端点（workspace/tab/pane/agent CRUD + pane output/keys）（2026-08-25）
- [x] solco-mobile: `host-client.ts` 新增 `getPaneOutput`/`sendPaneKeys` + 全部 P0/P1 方法
- [x] solco-mobile: `queries.ts` 新增 `usePaneOutput`/`useSendPaneKeys` hooks
- [x] solco-mobile: `pane/[paneId].tsx` Pane Terminal 详情页（wterm + VT→Herdr 映射 + 复制）
- [x] solco-mobile: `index.tsx` TERMINALS 折叠区（按 Tab 分组 + PaneRow + 导航）
- [x] solco-mobile: `control.tsx` Remote Control 树形视图
- [x] solco-mobile: `_layout.tsx` 注册 pane/control 路由
- [x] solco-mobile: `serve-web.mjs` `/pane/` 动态路由回退
- [x] `pnpm typecheck && pnpm lint && pnpm export:web` 全绿（2026-08-25）
- [x] ego-browser 验证：TERMINALS 区截图 + Pane Terminal 页面截图（2026-08-25）

### W2（solco-mobile）
- [ ] `src/contracts/host.ts` — wire→内部 transform（单点）
- [ ] `src/lib/host-client.ts` — HttpHostClient 对齐 W1 路径
- [ ] `src/features/host/queries.ts` — refetchInterval 兜底 + TODO(r6-events)
- [ ] `.env` — `EXPO_PUBLIC_SOLCO_HOST_URL=http://127.0.0.1:8787`
- [ ] 端到端验收：连接→选择→prompt→读输出
- [ ] 故障验收：错端口/停 Host→显式错误→恢复自愈

### W3（solco-mobile）
- [x] `app.config.ts` — web manifest（standalone / `#08090C`）+ favicon 指向（2026-08-24）
- [x] `public/` — 192/512 图标（maskable 双 purpose）+ favicon + `src/app/+html.tsx` 根 HTML 模板（manifest/theme-color 已验在 dist）
- [ ] `pnpm export:web` + HTTPS 伺服 dist/（临时反代或直接 W4）（export 侧已绿，HTTPS 伺服待 W4）
- [ ] 手机安装验收 + 杀进程 resume 重连验收（待 Tailscale HTTPS）

### W4（solco）
- [ ] Axum ServeDir 挂 dist/（同源）
- [ ] `https://<mac>.ts.net` 同源安装/联调复验（此时 CORS 白名单可退役）

## 检查命令

```sh
# solco-mobile
pnpm typecheck && pnpm lint && pnpm export:web

# solco（W1 冒烟）
curl -s http://127.0.0.1:8787/api/v1/hello
curl -s http://127.0.0.1:8787/api/v1/bootstrap | jq '.workspaces[0]'
```
