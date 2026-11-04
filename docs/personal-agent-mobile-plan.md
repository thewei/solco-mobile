# Solco Mobile — Assistants（Shepherdr 2.1 Go 对齐）与阶段 E 常驻远程计划

> **状态：2026-11-03 手机 Assistants / Host v3 早期实施规划；当前两端已有 Assistant/Goal/Task/Memory 及移动管理页代码。** 本文件保留后端契约来源，但“尚未实现”的历史文案可能过期。**2026-11-04 的新 UI 方案以 `docs/assistants-chat-first-mobile-plan.md` 为准：每个 Assistant 默认是 ChatView，管理功能移入 ⋯；联系人/助理↔助理私聊/群聊/@ 提及的产品设计见桌面 `solco/docs/assistants-conversation-product-spec.md`（UX0–UX6）；跨助手可见性、Herdr Skill/Mailbox、委派与调度的 Go 领域设计见 `solco/docs/assistants-collaboration-plan.md`。**
> **桌面唯一实施计划**：`solco/docs/personal-agent-go-mvp-plan.md`；**全量 2.1 测试追踪/批次验收**：`solco/docs/shepherdr-2.1-test-parity.md`，其源案例索引 `solco/docs/shepherdr-2.1-test-cases.jsonl`（168 文件/1,193 静态声明），测试状态和源案例 ID 在桌面仓统一管理，**手机不复制第二份清单**。`solco/docs/personal-agent-plan.md` 是历史 Rust-first 调研，仅保留来源证据。  
> **本端既有权威**：`AGENTS.md`、`CLAUDE.md`、`docs/mobile-product-architecture.md`、`docs/mobile-ui-ux.md`、`docs/implementation-roadmap.md`。如有冲突先修订 canonical 架构的批准决议；文档中的拟议路由不代表已上线。

## 1. 重新定位：移动端只是 Host 的客户端，Go 是核心

- **Mac Go Personal Agent daemon 是唯一业务写者**：Assistant（用户可创建的持续助手身份）、Goal、Commitment、按 Assistant 隔离的 Memory、Task、Execution、审批、Rules 和收据；基于已有 Go `solco-automations` module 的 daemon/runner/Herdr backend 延伸。**Shepherdr 2.1 是唯一主要源码/测试对齐基准**；旧 Rust `herdr-projects v1.2.27` 只在查旧 Herdr API 时参考，不 Fork、不运行、不成为移动依赖。
- **Herdr 0.9.5 仍是 Session/Agent/Pane/PTY 唯一权威**。移动端绝不接 Herdr socket、hc API 或插件数据文件，只通过 Mac `/api/v3` 发起动作、读取结果、跳转现有 Agent Chat。
- **桌面 UI 使用既有 WebView Chat `App`**：Mac 旧 `/projects` 页的 Chat+Inspector 组件可抽取为新的 `/assistants` WebView；主侧栏原 `Projects` 改为 **`Assistants`**，其中每行是有持久身份、长期跟进与记忆的助手；`Agents` 仍是实时运行 Agent 列表，`Workspace` 是 Herdr 工作区。手机继续复用已有单一 `Chat` 快照。不要复制 React Chat 到另一份移动实现，也不要直接拷贝 Shepherdr 的 Web UI。
- **单一自动化**：从 MVP 开始新增 personal 规则与原 `solco-automations` 规则都进入**同一个 Go daemon**；阶段 D 才统一历史存储/配置形态。不需要先迁两套 Rust/Go Scheduler。
- **责任边界**：手机 UI 负责自然语言发起、草案确认、Watching/Needs You、审批、结果跳转、离线提示；所有时间触发/条件评估/Agent 调用只在 Mac。
- **运行时间（2026-11-04 实际代码边界）**：现有 `solco/internal/hostd` 已提供带唯一端口 lease 的 Go 常驻 Host，桌面设置有 Keep Running When Solco Quits；可在 App 退出后继续提供 Assistants 和部分 Herdr 数据，但 `hostd/serve.go` 明确不提供依赖 GUI 的 Chat/History/Git/Files 等接口。**远程管理在线不等于 Assistant Chat 在线**；新 Chat-first 体验需按 Host capability 展示明确降级。Mac 睡眠/关机不可执行。

## 2. 产品 MVP：只做用户真正需要的三个页面

**(1) Assistants / Today / Watching**：显示用户的各个 Assistant（名称、状态、正在跟进的目标数、Needs You 数）。选中 Assistant 后展示 Needs You、Running、Watching；每行展示它负责的 Goal/Commitment 名称、上次确定性检查、下次检查、Agent Run 状态、是否需要批准。不同 Assistant 的 Memory/Goal 列表默认隔离。刷新由 Host authoritative 查询与 WebSocket 变更提示驱动，不在手机定时调度工作。

**(2) Goal / Task / Run Detail**：一条 Goal 的目标、退出条件、允许的权限、关联执行记录、最近一次证据、暂停/恢复；任务显示真实 Herdr Session + Pane，若仍活着则“查看 Chat / Terminal”，否则仅报告与历史，**不根据标题猜会话身份**。

**(3) Needs You Inbox**：仅列人工审批/Agent blocked 等明确动作，每张卡说明实际动作、影响范围、预计资源、过期时间。一个 actionHash + expectedRevision 仅能接受一次；手机 A 已批准，手机 B 必须得到 stale/conflict 状态。

**创建入口**：`New Assistant` 创建持久身份（名称、职责、是否关联 Workspace、允许的工具与记忆范围），默认可提供一个 `My Assistant`。每个 Assistant 拥有独立的 Coordinator SessionRef，真实对话继续使用现有 Chat；给 Assistant 发自然语言后返回 Goal Draft，用户阅读目标/频率/退出条件/权限/预算后批准。MVP 要求创建第二个 Assistant 后，两者的 Goal/Memory/Chat 身份不会串线。绝不将随口想法静默变成自主任务。

**保留现有**：`/automations`、History、Git/Files、Sessions、Remote Desktop、Terminal。阶段 D 前禁止移除旧 Auto 页面。

## 3. Host /api/v3 的提议契约

所有端点均拟新增，Go Host 是唯一鉴权边界，手机只见稳定的业务 DTO，**不暴露 daemon 进程路径、CLI argv、原 Herdr 结构**。采用 Bootstrap capability gate：

- `personalAgent`：Go Personal Agent daemon 可用且版本验证通过；UI 名称显示为 `Assistants`，不要求为文案更改重命名已有 API capability。
- `personalAgentManage`：当前配对设备有管理权。
- `personalAgentApprove`：该设备及对应 action policy 允许当前审批类别。**不能单靠一个 bool 作为高危行动的最终授权**；后端再次校验 actionHash、版本、策略、是否确属用户明确操作。

提议 API（第一批只实现标 MVP 的项目；具体线协议由 Mac golden 锁定）：

| 方法与路径 | 目的 | 阶段 |
| --- | --- | --- |
| GET `/api/v3/personal-agent/overview` | counts、nextCheck、NeedsYou、最近 Task/Run，按 assistantId 隔离 | B |
| GET `/api/v3/personal-agent/assistants` | Assistant 列表及各自的计数、版本、范围 | B |
| POST `/api/v3/personal-agent/assistants` | 创建助手身份（只建档，不启动高权限 Agent） | B |
| GET `/api/v3/personal-agent/assistants/{id}` | Assistant 详情、关联 Workspace、目标、Coordinator SessionRef | B |
| POST `/api/v3/personal-agent/assistants/{id}/rename` | 重命名，expectedRevision 防冲突 | B |
| GET `/api/v3/personal-agent/goals` | 当前 Mac 的 Goal/Commitment 列表 | B |
| GET `/api/v3/personal-agent/goals/{id}` | Goal detail/关联 Task/最后结果 | B |
| POST `/api/v3/personal-agent/goals/draft` | 生成草案（只持久化，不启动 Agent） | B |
| POST `/api/v3/personal-agent/goals/{id}/approve` | 审阅后批准 | B |
| POST `/api/v3/personal-agent/goals/{id}/pause`、`resume` | 控制未来 Watch，不暗中终止在途 Agent | B |
| GET `/api/v3/personal-agent/tasks/{id}` | Task 的真实状态与执行关联 | B |
| GET `/api/v3/personal-agent/runs/{id}` | Run 结果、时间、证据、pane 跳转 | B |
| GET `/api/v3/personal-agent/approvals` | Needs You / blocked / 待批准卡 | B |
| POST `/api/v3/personal-agent/approvals/{id}/decision` | 允许 / 拒绝精确操作 | B |
| GET `/api/v3/personal-agent/memory` | 已批准记忆与来源（受 scope 约束） | C |
| POST `/api/v3/personal-agent/memory/{id}/review` | 确认 / 更正 / 删除记忆 | C |
| GET `/api/v3/personal-agent/rules` | 统一 Auto 列表（旧规则与 Personal） | D |
| POST `/api/v3/personal-agent/rules/{id}/...` | 同一 Go Rule Authority 控制 | D |

**写入协议**：Assistant-owned Goal/Task/Memory/Run 操作必须指定被授权的 `assistantId`；`requestId`（重放返回原 receipt）、`expectedRevision`（不同状态/版本返回 409）、关键审批 `actionHash`；发送正文时 HTTP Bearer、WebSocket `['solco.bearer', token]` 仍用当前 Host 客户端，拒绝 token/query 参数日志。`requestId` 幂等是 daemon 持久记录而不是 UI 按钮禁用；Host 无法确认 Agent 是否启动成功返回 `uncertain`，客户端不得自动重复提交可能有副作用的写操作。

**状态事件**：现有 `GET /api/v3/events` 推 `personal-agent.changed`，仅含 `revision`/`counts`/受控 ID，绝不推 prompt、memory 正文/凭据；收到事件就 invalidate TanStack Query 并重新 GET。离线、WebSocket 丢帧、App 从后台返回都拉权威快照。已删除/撤销的设备连线与写权限必须即时生效。

**Host 实现依赖**：桌面 Go 根 module 的 `internal/personalagent` 只通过 CLI/受控 Unix RPC 与子 module 内 daemon 对话，不能读取它的 SQLite；**当前子 module `plugins/solco-automations` 有自己的 go.mod**，根 module 不应直接导入其 `internal/*` 包。

## 4. 代码变更的明确位置

| 移动端文件 | 动作 |
| --- | --- |
| `src/contracts/host-v3.ts` | Zod schema：capability、**Assistant**、AssistantScope、Goal、Commitment、Task、Run、Approval、API error |
| `src/lib/host-client-v3.ts` | 只加有类型的 Personal Agent 请求，复用现有 pinning/credential/Relay/host 分流 |
| `src/features/host/queries-v3.ts` | TanStack Query hooks 与 mutations；cache key 以 `['v3', ...]` 开头，并按 Host ID 隔离 |
| `src/features/host/personal-agent-model.ts` | UI 纯函数：分组、状态、时间、文案、不可用提示；没有服务器事实推断 |
| `src/app/assistants/index.tsx` | Assistants 列表、New Assistant、Today/Watching/Needs You |
| `src/app/assistants/[id].tsx` | Assistant detail + scoped Goals/Tasks/Memory、Coordinator Chat |
| `src/app/assistants/approvals.tsx` | 待审批 Inbox，过期/重复操作禁用 |
| `src/features/host/background-bridge.tsx` | events WS 变更提示、前后台切换时失效数据 |
| `src/contracts/__fixtures__/v3/` | 由 Mac Host 自动生成的 golden 逐字同步，绝不能手改 |
| `src/app/automations/*` | D 阶段加兼容提示/重定向；B MVP 保持原状 |

尽量不增加独立的 Zustand 业务持久化；只存客户端选中的 Goal/Tab 筛选等纯 UI 状态。手机上的 Secret 继续只由 SecureStore/已验证连接层持有，业务 API 不拿原始凭据。先复用组件/主题，不复制 Shepherdr JSX/CSS。

## 5. 与 Mac A–E 的逐阶段验收

### A0：全量测试资产（已完成盘点，手机不用同步源码）

- 桌面仓已完成 168 个上游测试文件/1,193 静态测试声明的 AST 索引、46 条优先场景分批台账以及校验脚本。此时还没有新的 Go parity 测试通过；源测试里的 hc/Bun/浏览器能力不能当作手机功能已经具备。
- 手机只引用上游测试 ID 和桌面 Go Host 产生的真实 golden，禁止复制 TS 测试代码到 RN 或假造服务器响应；另需覆盖桌面 `solco/docs/solco-assistants-required-cases.jsonl` 里的 **31 条 Solco 必测场景**，其中 R01–R05 和 A03/A06 需要移动端协作证据。旧界面/配对保持正常。

### A：Mac Go Task Core 验证（手机不做大面积 UI）

- 按桌面 `A1/A2` 批次先写 durable receipt/Herdr adapter 的失败测试，后写 Go 实现；Mac 通过现有 Herdr 0.9.5 Agent/Pane 真正运行一个任务，并能读回已持久化的 RunID/PaneID。
- 手机只验证旧 Host/Automations 能力不退化，新 capability 未启用时不显示假入口。
- 若适合，先加 Zod 只读 fixture 的合同测试（必须来自真实 Mac，不能造“已上线”接口）。

### B：可给用户实际测试的 Assistants MVP（B1/B2/B3 逐批合并）

- Mac Go **Assistant create**、Goal draft/approve、PR deterministic Watch、真实 Herdr Agent、Run 结果可被 Host 读取。B1 先过 Assistant 身份/Memory 隔离的 Solco 自有测试（上游 2.1 无完整等价项），B2 过 Source 2.1 claim/event/精确权限，B3 才做 Host golden 与 UI。
- 手机 Assistants 选择/创建、Today/Watching、详情/审批、暂停/恢复、打开同一 Chat 工作；连接通过 LAN/Relay 现有路径，无额外端口配置。
- 验收一：Mac 和手机各发一次同样 requestId，不得新增两个 Agent；两个不同 Assistant 即使关联同一 Workspace，Goal/Memory/审批也不得串线。
- 验收二：PR 未变化时不调用 LLM；变化时创建一个 Run；GitHub API 失败明确显示“检查失败”。
- 验收三：用户取消一个 Goal，后续不触发；在途 Agent 按明确单独控制决定。
- 验收四：Mac App 完全退出时手机报告“Host 离线”，但 Go 后台执行不因此被错误取消。

### C：可靠跟进、记忆与自主目标（C1/C2）

- C1 根据 `S21-14ef37640468`、`S21-59f28436af19` 等原测试场景验证 Heartbeat 清单/事件水位线在重启后保持；手机展示最后/下次唤醒、运行证据与离线状态。
- C2 验证 Solco Memory 候选审阅、来源、改正与删除、跨 Assistant 默认不共享（SOLCO-M01–M06），手机不得把模型总结直接写入长期记忆。
- 组合触发、外部条件、重复事件、双手机批准竞争、Agent 失联后 uncertain 采用 Host 权威冲突状态；移动端不擅自重试。

### D：统一 Automations（D1/D2）

- D1 先在 Mac 对旧配置进行 disabled/dry-run、字段/时区/next-fire 对账，再由用户确认单规则迁移；手机要能区分 legacy/new/迁移中。Shepherdr 2.1 本身不覆盖 Solco 旧 YAML/JSONL 的完整迁移行为，必须使用 SOLCO-D01/D02 和已有 Go 插件全量回归。
- 保留现有手机 `/automations` 的所有创建、草案、approve、Run、Pause/Resume 与历史入口；直到新版接口覆盖且旧 Host 兼容测试过门槛，才可用 Personal Agent 的 Rules Tab 承接。
- 不能让新旧规则同时派发同一个触发。

### E：**完整 Go 核心 + Mac GUI 关闭后仍可远程管理（E1–E4）**

- 所有 Assistant/Goal/Memory/Task/Coordinator/Watch/Review/Automation 由一个 Go service 管，生产无需 Rust/Shepherdr Task sidecar。E1/E2 按 2.1 任务依赖和 Git/Review 测试对照、E3 审核平台/权限否定场景、E4 再迁移唯一 Host 的配对和监听。
- Host v3/证书/DeviceStore/Relay 的“唯一服务拥有者”从 Mac GUI 按设计搬进 Go 常驻 service，不能与旧内嵌 Host 同端口双开。原来的 Mac App 变成这个 Host 的 UI 客户端。
- 手机不变更 /api/v3 的用户语义：重新配对原则上不应该成为每次升级的必要步骤；证书/fingerprint 和设备权限迁移必须保持一致或明示迁移并回滚。
- 真机验证“macOS 窗口关闭”“Mac App 彻底退出”“Herdr daemon 独立存活”“睡眠/关机”“Mac 重启后 launchd 启动”五种不同状态。只有 Host 实际在线，手机才显示在线和可远程管理。
- Remote Desktop 仍可能依赖 UI 会话与 TCC，需要明确的 availability/capability gate，不可把原 macOS helper 权限无审核迁入常驻进程。

## 6. 可落地的验收矩阵

| 情形 | 正确结果 |
| --- | --- |
| 旧 Mac 不支持 personalAgent | 不显示可操作 Assistants，旧 Automations 保持可用 |
| 手机两次批准同一动作 | 后一次 409 stale；Mac 只有一个权威回执 |
| 与 Mac 断线期间任务仍在运行 | 手机显示缓存时间与离线标记；重连再读取真实状态 |
| Agent blocked / 需要终端信任 | Needs You 与当前真实 pane，不能伪造“任务完成” |
| Mac 关机/睡眠 | 不显示后台持续执行能力 |
| API 429/401/500 | 不能把观察失败报告成“PR 仍未合并” |
| 改动 Goal 后旧授权卡被点 | 409，必须重新审阅最新影响 |
| 内嵌 Chat / Shared Chat View | 只使用 `frontend/src/App.tsx` 单一源，不出现两份对话状态 |
| 既有 Auto Rule | 新 Go Agent Core 不改原调度历史；D 的切换必须可回滚 |
| 撤销手机配对 | 后续 HTTP/WS 都无权访问，历史列表缓存随之失效 |
| 完全退出 GUI 后手机访问 | A–D 正确提示 Host 不可用；E 通过常驻 Host 可以读/写授权功能 |

## 7. 验证与交接

**macOS**：`GOTOOLCHAIN=auto go test ./...`；**Go automations 子 module 另运行** `cd plugins/solco-automations && GOTOOLCHAIN=auto go test ./...`；`GOTOOLCHAIN=auto go tool mygo build`；WebView 前端 `cd frontend && bun run build`。所有 Herdr Task 实测使用独立临时 HOME + HERDR_SESSION + Git scratch repo，绝不在用户现有 worktree 中破坏式测试。

**Mobile**：`pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm check:fixtures`、`pnpm check:chat-page`、`pnpm export:web`；涉及 Chat 共享源码更改必须 Mac `bun run build:mobile` + Mobile `pnpm sync:chat-page` 同步产物；涉及 API 新 Golden 时先从 Mac `internal/remotehost/testdata/api-v3/` 更新，再 `pnpm sync:fixtures`。Android 先做真实设备 Development/Release 验证，iOS 以本机 Xcode SDK 兼容性决定测试类型，不能凭 TS test 声称 iOS 原生成功。

**Go 核心最终验收**：E 阶段不能只声称“旧 herdr-projects 已移除”；桌面 `node scripts/check-shepherdr-2.1-parity.mjs --gate=all` 必须确认所有 1,193 个上游源测试声明都有最终 Go 等价/Herdr 适配/现有 UI 证据或有理由的不适用决定，并且 **31 条 Solco 自有用例全部已验证**，**不等于必须把 1,193 个 Bun 测试一比一重写**。另必须通过 Solco 自有 Assistant 身份/长期 Memory/设备授权/旧 Auto 迁移用例，并实测两个以上 Assistant 的独立 Coordinator、真实 Herdr Agent、Task Review/Merge、事件去重、Cron 历史、daemon crash 恢复、GUI 完全退出后的手机服务。Mac/手机共用同一真实性契约。

**本次只更新文档，不修改运行中的 Go daemon、手机路由、配对配置或旧自动化规则。**
