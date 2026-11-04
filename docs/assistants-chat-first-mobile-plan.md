# Solco Mobile — Assistant Chat-first 配套重构计划

> **状态：2026-11-04，按当前已实现手机代码审计后的下一阶段设计，未改 UI/Host 代码。**
> **桌面主计划**：`solco/docs/assistants-chat-first-redesign.md`。保留 `docs/mobile-product-architecture.md` 的单 Host/Herdr 运行时、同源 Chat 页面、Expo Router/Tamagui、设备配对与 client-local 导航规则。现有 `docs/personal-agent-mobile-plan.md` 记录 Go Assistant 核心与 Host v3 的早期实施顺序，本方案取代其中「Assistant 详情=Needs You/Watching/Tasks/Memory 管理长页」的产品界面假设。

## 1. 真实代码审计

| 文件 | 现在的实现 | 新目标 |
| --- | --- | --- |
| `src/app/assistants/index.tsx` | 计数卡片/Needs You/新建 Assistant | 像聊天软件的联系人列表：头像/名字/可信最新动态/未读；点击直接聊天 |
| `src/app/assistants/[id].tsx` | 长 ScrollView 的 Needs You、Watching、Tasks、Done、Remembers；顶栏 Watch PR/Pause/Rename | 直接打开共享 `ChatPageView`；这些卡片和管理动作移入右上 ⋯ /聊天事实卡 |
| `src/app/chat/[paneId].tsx` | 已用 `ChatPageView` + `createChatController` + Host `useChatStream`，有 Chat Composer/Question/Voice/Attachments/Queue | 抽离复用 Chat session/controller 的 hook/shell；AssistantID 解析出真实 Pane 后用同一 Chat，不复制这页的业务逻辑 |
| `src/features/chat-web/{controller,page-state,protocol}.ts` | Desktop Chat 单一生成页的手机 bridge | 保持一个 `CHAT_PAGE_HTML`、一个 controller 实现；允许以 scoped Assistant binding 传目标与能力 |
| `src/contracts/host-v3.ts`、`src/lib/host-client-v3.ts` | 有 Assistant/Goal/Task/Memory/Approval，但 `assistantDetail` 无 Coordinator source；能打开 Task Run 的普通 Chat | 增加 AssistantConversation binding/ensure 的 Zod/typed API；真实能力宣告，老 Mac 降级 |
| `src/features/host/queries-v3.ts` | Assistant Detail/Inbox 重新 GET；`personal-agent.changed` 做 invalidation | Assistant Chat 走现有 Host stream；Metadata/More 只有打开才取，WS 丢帧/前台恢复再快照纠偏 |
| `src/app/_layout.tsx` | 普通 Chat 与 Assistant 是不同路由，普通 `chat/[paneId]` 才有共享 Chat | `assistants/[id]` 变成聊天主体，可继续保留普通 Chat 页，二者共用组件/transport |
| Mac `internal/remotehost/personal_agent.go` | 只能查 Assistant 详情/目标/任务/审批/记忆；没有 Assistant 自己的 Coordinator binding API | 新增 `/assistants/{id}/conversation` 查询与幂等 ensure，经过精确 Herdr Session/Pane 验证后才能发送 |

**特别注意当前 Go resident Host 已存在**：`solco/internal/hostd`、`internal/nativeui/remote_settings.go` 有「Keep Running When Solco Quits」和端口唯一租约；resident Host **可管理 Assistants/查 Herdr 树**，但目前 `hostd/serve.go` 明确不接 GUI-bound Chat/History/Git/Files 等缝，因此**Mac GUI 退出后手机可能仍能查看 Assistant，却不能继续 Chat**。P1 必须如实显示「聊天暂不可用」，不能因为 Assistant 列表仍在线就暴露假的 Composer；若以后要 GUI 退出仍持续 Chat，需另做 HostConversationService 去窗口化和真实 Agent E2E，不属于前端换皮的自然结果。

## 2. 产品流程

**列表**：Assistant 行展示 Avatar + Name，右侧 Needs You/未读标志，第二行展示可信最近一条聊天/活动或 “Following 2 things” 等权威状态。不能从 Goal title 猜“助手最后说了什么”。添加后直接进入该 Assistant Chat。

**聊天详情**：顶部 Back、Assistant 名/状态、⋯。中央是同源 WebView Chat，原 Composer、Prompt/Stop/Answer、Queue、Slash/Skills、Voice、Attachments、Question Dock 均继续；后台事实（PR Update/Task/Approval/Memory candidate）在 Chat 里显示独立、可验证来源的轻卡片。无真实会话也可打开**聊天壳/空历史**；首次发送通过同一 Host 控制流程确保/启动 Herdr Session 并发送一次。若 Host/Chat 不可用，保留草稿、禁实际发送、说明原因。

**⋯ 更多**：Gorhom/Tamagui Sheet 分类：
- About：头像/名称/职责/通知/暂停
- Memory：记住的事实、建议记忆、来源、纠正、忘记、共享范围
- Goals & Follow-ups：持续监控、规则、时间、暂停/取消
- Tasks & Activity：任务、运行、需要你、已完成、打开原 Pane/Chat/Review
- Context & Workspaces：当前注入的记忆 ID/版本/来源、实际 Workspace/Skills/Tools、模型上下文（可读才展示）
- Capabilities / Automations / Files / Git / History：跳现有功能，必须有 capability、来源权限与后端审批

返回时保持 Assistant 聊天 scroll/draft/Queue；不能为了打开一个 Sheet 卸载共享 WebView 并丢状态。Needs You 通知跳对应 Assistant/准确卡片，不能落错身份。

## 3. 手机专属会话适配

~~~text
/assistants/[assistantId]  (稳定用户入口)
    → GET Assistant Conversation Binding via paired Host
    → verified host instance + Herdr session/pane/agent session
    → existing useChatStream / ChatOps / ChatPageView
    → existing Host Chat Send/Stop/Answer/Queue
~~~

- 要有一个 **AssistantConversationResolver**（在 Mac Go/Host，**不是手机按名称匹配**）负责 `assistantId → 真 SessionRef/PaneID/ProviderSessionRef`。Coordinator 重启换 Pane 但 AssistantID 不变。Assistant A/B 快切要重新定位并清理旧订阅、拒绝迟到 A 事件；draft/scroll/queue 以 AssistantConversation key 做客户端隔离。
- 新 `GET /api/v3/personal-agent/assistants/{id}/conversation` 给 live/stopped/offline/uncertain/starting 状态和准确 source refs；`POST .../conversation/ensure` 带 `requestId`（保留 payload hash/幂等），只因明确 Send/Start 才触发。服务端每次 send/answer 重新核实助手权限、session 归属和 revision；若当前 Host Chat Send 无 assistant scope 校验，增加薄 Assistant façade 而不是第二消息队列。
- 调用现有 `ChatPageView`，把当前 `src/app/chat/[paneId].tsx` 的 controller/ops/headless pending 模式抽取公共 hook；不能简单在 Assistant 页面嵌套另一页带 Mac 当前 PaneID 的 router route，因为切换/重建时会丢 Assistant 稳定身份。
- 已保存的 Provider Chat History 由现有 Host Conversation/History 读取；无可信历史则只是空态，不把 Memory/Run History 伪造为消息。Assistant 活动属于独立时间线事实（sourceRef）、不能冒充 Agent 文字。
- 更改 Memory/Context 时一律 Go 权威、设备 scope、requestId/revision；已发给模型的旧 prompt 不可能通过手机 Forget 操作撤回。
- resident Host 没有 Chat capability 的情况下**仅管理/查看 Assistant**，不能让用户误以为远程 Composer 已能发；屏幕仍可以保留未发送草稿。未来 headless Chat 对应单独能力门禁与实机测试。

## 4. 移动端改造分批

| 批次 | 实施文件 | 需要验证 |
| --- | --- | --- |
| **M0 · 合同测试** | `src/contracts/host-v3.ts`、Mac Go Host golden、`features/host/personal-agent-model.ts` | 真实 assistantId→binding；无能力/断线；旧 Host 和 resident Host downgrade |
| **M1 · Chat-first 最小版** | `src/app/assistants/[id].tsx`，共用 `chat/[paneId]` 的 ChatOps/hook，现有 `ChatPageView` | 点 Assistant 直接 Chat；第一次发言只启动/发送一次；A/B 不串历史；不动 Mac 焦点 |
| **M2 · 列表与 ⋯ Sheet** | `src/app/assistants/index.tsx`，More Sheet/二级页，App Router | 不用管理仪表盘；打开/关闭 More 不丢草稿与位置 |
| **M3 · 记忆/Context/事实卡** | Host Memory/Context/Activity DTO，现有审批卡、Goal/Task 组件 | Memory 来源、纠正/忘记/分享/审批有真实反馈；活动不能装成 Agent 发言 |
| **M4 · 稳定性与优化** | Chat stream 断线恢复、offline、现有 Chat 快照、Android 真机 | 不重复 Agent；双手机/多 Mac/撤销设备安全；普通 Chat/自动化/远控不退化 |

**实现优先级**：先 M0/M1，产品第一感受就变化。M2/M3 可以渐进上线，不能等到所有记忆和上下文深度功能才开始呈现 Assistant Chat。

## 5. 验收与跨仓工作流

- 手机收到 Assistant 详情后不再渲染任务管理长列表为主视图；每次打开都见同一个 `ChatPageView`。
- Mac/Phone 分别打开 Assistant A，再切 B，再返回 A：真实 transcript、草稿、未答、Queue、Memory 不串；手机改变 Assistant 不移动 Mac 选中 Pane。
- Android Development Build 中，输入法/键盘与 Chat WebView 原现行为保持正常；返回 更多/审批详情不丢内容。
- 新建 Assistant 后直接在 Chat 输入首次消息；请求断线/重试/Host 崩溃只有一个真正 Session/Prompt；uncertain 禁无条件重发。
- 单独的普通 `/chat/[paneId]`、`/automations`、Sessions/Git/Files/Terminal/Remote Desktop 继续可用。
- Host v3 先由 Mac `internal/remotehost/testdata/api-v3/` 产生真实 golden 再手机 `pnpm sync:fixtures`，不能手写 fixture；改 shared Chat 后必须 Mac `bun run build:mobile` + 手机 `pnpm sync:chat-page` / `pnpm check:chat-page`，不能在 RN 中 Fork Chat 源码。
- 手机 `pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm check:fixtures`、`pnpm check:chat-page`、`pnpm export:web`；Mac `go test`（root + 独立插件 module）和 `bun run build`；Android + macOS 真机验证可记录证据。未做的测试必须明确标记未做。
- 新能力通过可选 Host capability gate；老 Mac、已撤销设备、无 Chat 的 resident Host 都必须如实降级，绝不能通过 unpinned 网络绕过配对权限。

**本次只有下一阶段 UI/Host 改造设计，不改变运行中的 Assistants、Chat、手机会话或后台数据。**

## 6. Assistant Network：协作/暴露/管理的新规划（2026-11-04）

主规范：`solco/docs/assistants-collaboration-plan.md`。这是在 Chat-first P0–P4 之上逐批开发的 **N0–N6 协作层**，不是已发布功能。Go daemon（同一 SQLite 写者）拥有 Assistant Directory、可见性与 grants、消息线程与回执、Delegation、TaskGraph/Run、Rule/Activity，手机只通过已配对且能力已宣告的 Host API 读写。

### 6.1 手机 Assistant 仍是聊天，协作在 ⋯ 中管理

- `/assistants/index`：联系人/会话列表（名字、可信最近动态、需要用户、运行状态）；助手间通讯不应把这页变成项目总览。
- `/assistants/[id]`：原 ChatPageView；可见「已请求测试助理帮忙」「测试助理接受」「2 个子任务正在执行」「自动化下次检查」的**真实系统事实卡**，每张卡有 sourceRef/assistantId/threadId/delegationId，**不是伪造的 Agent 回复**。
- `⋯ → Visibility & Collaboration`：主开关「允许其他助理发现我」，**默认关**；进一步选择公开名片、允许收消息、接受委派、公开有限进度、逐条共享记忆；能看目前谁有权限、已往来协作关系、撤销与最近访问活动。关闭公开要立即阻止新发现/新送达，已有历史 Owner 可追溯。
- `⋯ → Tasks & Activity`：树形/分组看自己的 Task → Worker Run、外包给另一 Assistant 的 Delegation/对方是否接受/最终结果；点击真实 Run source 可打开普通 Chat/Terminal，切换到别的 Assistant 需明确跳转，不重绑 Mac 当前 Pane。
- `⋯ → Follow-ups & Automations`：仅浏览自己的规则、频率、最近运行和执行状态；复杂规则编辑仍使用现有 `/automations`，新建一定 draft/人工批准。
- `Manage Assistants`（从 Assistant 列表顶栏或全局 Needs You 打开，作为二级页面）：Owner 管理中心，集中展示所有**包括 Private** 助理、在线/暂停、消息请求/委派链、Task DAG、自动化、审批和权限。手机重点做列表/折叠详情与过滤，桌面负责密集多列调度视图；不把全套图塞到小屏。

### 6.2 手机权限和网络边界

- 可发现（discover）只暴露名片；`read_profile`、`receive_message`、`accept_delegation`、`share_memory`、`share_activity` 独立授权；只有 Owner 有权改 visibility/grants。手机的配对设备还必须具备 Host `ScopeManage`/`ScopeApprove` 对应真实能力，不能仅有登录连接就管理权限。
- 不允许移动端直接向别的 Assistant 的 Herdr Pane 发送无审核 `agent prompt`；所有 peer send/accept/decline/revoke/ack 从 Go facade 走，强制 caller/target/策略/幂等/成本。手机是用户 Owner 管理面，Agent 是具有绑定 source 的受限调用者，两类身份不可混同。
- Host v3 拟议端点按主规范添加：`GET /api/v3/personal-agent/directory`、`GET|POST /assistants/{id}/visibility`、`GET|POST /assistants/{id}/grants`、`GET|POST /assistants/{id}/messages`、`GET|POST /delegations`、`GET /control-center`（最终命名以 Mac Go golden 为准）；新能力通过可选 `assistantNetwork`/`assistantNetworkManage` 显式宣告，不强迫旧版本手机重配对。
- 事件帧只携带 assistantId/revision/counters/thread ID/类型，不带消息正文、记忆、token、Run 日志；Foreground/WS reconnect/Host handoff 按权威快照校正。跨设备发送同一个 requestId 不创建重复 peer 消息或任务。
- 现有 `internal/hostd` GUI 退出后可管理 Assistants 但尚没有 GUI-independent Chat；手机若仅看得到目录/协作收件箱，不得假装 Chat 可用。并且只有业务后端已经实施的接口才能在 resident Host 暴露。
- Herdr Skill 只在真实 `HERDR_ENV=1` Agent 内运行；手机不运行 Herdr Skill，也不直接访问 Herdr socket/SQLite。即使 Agent 公开，它在同一 macOS 用户 shell 下的访问限制仍不是 OS 安全沙箱，应按主规范准确表达。

### 6.3 手机对应的实施批次

| 阶段 | 手机任务 | 验收 |
| --- | --- | --- |
| **N1 Directory** | 列表提供 Owner 看全部、Assistant 可见性设置 Sheet，Host Golden/Zod/Queries | 旧 Assistant 默认 Private；关闭公开即时拒绝 Agent 发现 |
| **N2 Peer Mailbox** | 对话的协作事实卡、协作线程详情、Needs You 接受/拒绝 | 消息离线保留，B 回复关联 A，UI 不伪造 Provider 对话 |
| **N3 Delegation & Worker** | Tasks 折叠图、真实 Run Pane 打开、跨 Assistant 委派状态与审批 | A/B 任务归属准确，能查看授权范围的结果 |
| **N4 Rules & Continuity** | 自动化/承诺进度和 checkpoint 来源展示 | Android 后台/Mac 重启后从权威状态恢复 |
| **N5 Control Center** | Manage Assistants 二级页面、全局 Inbox/Directory/Rules/Memory grants | 聊天始终是单 Assistant 默认首页，管理调度集中且不丢草稿 |
| **N6 真机回归** | 多手机/Relay/断线/旧 Host/撤销设备、50+ Tasks、权限冲突 | 与 Mac `NW-01..NW-22` 场景一致；没有错误跨助手数据或重复 Run |

### 6.4 与旧 UI 迁移的关系

先完成已有 Chat-first **P1（安全的 Assistant→Chat 绑定）**，N1/N2 才能逐步在主 Chat 插入协作卡；P2 的 More Drawer 加入可见性/通讯/任务，P3 Activity 支撑结果状态。**不要用大管理面板替代 Chat 首页**，也不要把不同助理的对话 thread 当普通用户 Provider transcript。


## 7. 新产品规范：Contacts + Human DM + Peer DM + Group（UX0–UX6）

**产品规范**：桌面 `solco/docs/assistants-conversation-product-spec.md`（经 Grok Bot / Slack / Poe / Teams / OpenClaw 官方机制对照）。本章**取代**之前“手机 Assistants 页面只显示长期助手列表、Peer 消息只作为 Activity 卡、无 Group”的不足。Go Network `N0–N6` 仍是技术实现批次，手机按 UX0–UX6 产品交互分步提供。

### 7.1 手机 Assistants 首屏

- 顶部 `Chats | Contacts`，Groups 作为 Chats 的筛选（不是创建一个冗余底部 Tab）；右上 `+` 统一入口「New Assistant / New Group / New Message」。
- Chats 混合显示**个人 Assistant 私聊**（单头像）、**A↔B Peer DM**（双头像）、**多助理 Group**（叠头像），统一消息摘要/最后活动/未读、置顶、静音、隐藏；隐藏不停止后台 Goal/Rule。
- Contacts 展示用户拥有的 Assistant（含 private）、主要助理、公开资料、职责标签、可联系性、可邀请到 Group 的能力；Agent 发现目录另有授权限制，不能因为 Owner 手机上能看到就认为所有 Agent 都能查。
- 可指定一位 **Primary Assistant**；创建新 Assistant 只问名字和可选职责，创建后立即进入原 `ChatPageView`，在聊天中提出长期职责与 Memory Candidate。

### 7.2 会话详情路由（现有代码最少改动）

~~~text
/assistants/[assistantId]                      ← 旧深链保留，解析到 human_dm
/assistants/conversations/[conversationId]     ← 拟议统一 Chat 路由
                                      ├─ human_dm (Host/Herdr Provider Chat)
                                      ├─ peer_dm  (Go ConversationStore/Mailbox)
                                      └─ group    (Go ConversationStore + @ Dispatcher)
~~~

- 主体仍然用**同一个** `src/components/chat/chat-page-view.tsx`、`src/features/chat-web`、Shared Chat HTML/Composer/Question/Attachments/Voice 的可用能力；不同 `ConversationTarget` 只更换**受控 transport、Header 和 Composer policy**。不能 Fork 或复制 Chat 组件。
- Peer DM 顶部显示 A/B 双头像与双方角色；Owner 默认只查看，可选择向 A/B/两者精准插话，署名必须显示自己。Group 顶部叠头像、成员与群设置；`@` 的选择器按稳定 AssistantID 找目标，Reply 引用确切 message ID。
- 在 Group 默认无 `@` 的发送**不会调用模型**；有 `@A` 只唤醒 A，多个 `@` 用后端验证后的集合。消息属于 Group/Peer Go store，不是 Provider transcript，也不会自动变成某个长期 Assistant 的 approved Memory。
- 群入/退、私人 Assistant 受限邀请、历史授权范围和权限撤销必须明确可见。无法 Host 授权时不显示虚假的发送成功；Mac GUI 退出但 resident Host 没有 Chat ability 时群/Peer 可只读（仅当这些业务 API 已真实上线）。

### 7.3 Composer/聊天卡的行为

| 操作 | 用户可见结果 | 验证点 |
| --- | --- | --- |
| A 私聊 `@B` | 选择器 + Consult/Share 小预览；发送后显示「A 已联系 B」事实卡，可打开 A↔B DM | 不把 B 加进 A 的 human_dm；不共享整段私聊 |
| Group `@B` | 只唤醒 B，B 的真实消息显示为 B 头像/姓名 | 目标 typed assistantId；默认非 @ 成员不运行 |
| Reply 某条助理消息 | 顶部引用条 + 定向回复目标；返回/取消不丢草稿 | replyToMessageId 精确 |
| Owner 打开 A↔B 私聊 | 观察两位 Agent 真实消息，显式选择向谁插话 | 不把 Owner 说的话冒充 A/B |
| Task/Run/Automation 卡 | 只显示可验证状态/证据、Open Run、Review、Pause（如已授权） | Go authority、真实 Herdr identity |
| 长消息/长群/多设备 | 分页、增量更新、未读水位线、离线 draft 保留 | WS 重连/旧 Host 能力降级 |

### 7.4 Mobile 的增量代码和接口责任

- `src/app/assistants/index.tsx`：联系人与混合会话列表；`[id].tsx`：Assistant 旧深链映射 human_dm；建议新增 `conversations/[conversationId].tsx` 与 `src/features/assistants/conversations/*` UI 模型。所有 Session/Conversation IDs 不推测 Pane 名称。
- `src/contracts/host-v3.ts`、`src/lib/host-client-v3.ts`、`src/features/host/queries-v3.ts`：按 Mac Go Host 真正 golden 增 `assistantConversations/assistantGroups/assistantContacts` 等 capabilities；服务端明确验证每条 typed mention、参与者与 grants。
- 新建群、邀请/撤销成员、发送/Reply 都要求 requestId/expectedRevision，旧 Host 未支持时只能显示可用的 human_dm/Contacts，不自动创建本地假群消息。
- Chat 复用源码改变时必须 Mac `bun run build:mobile` 再 `pnpm sync:chat-page`，有 Host API 变化时必须 Mac golden → `pnpm sync:fixtures`；手机 `pnpm typecheck/lint/test/check:fixtures/check:chat-page/export:web` 并用 Android Development Build 实机检验键盘、@ Picker、群回复与导航。

**新增验收矩阵**：桌面产品规范的 `CONV-01..30` 与既有 `CX-01..15`/`NW-01..22` 并行；优先落 UX1 联系人与个人 Chat → UX2 @ Directory → UX3 Peer DM，再 UX4 Group、UX5 任务自动化卡、UX6 Owner Control Center。**群聊不是 Agent↔Agent DM 的前置条件。**

