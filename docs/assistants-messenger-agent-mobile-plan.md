# Solco Mobile — Assistants Messenger / MCP / Goal Follow-through 3.1

> **状态：2026-11-04 最新用户产品决策和代码审计后的手机实施计划，尚未改运行时。**
> **主文档**：`solco/docs/assistants-messenger-agent-v3-1-plan.md`（MU-01～MU-23），覆盖旧 `docs/assistants-platform-mobile-plan.md` 的三类 Marketplace/Lua/TS Plugin Runtime 假设。协作与用户体验延用 `docs/assistants-chat-first-mobile-plan.md` 与桌面 `docs/assistants-conversation-product-spec.md`。**插件只指 MCP Service，预置智能体是 New Assistant Preset，Go Workflow 框架选型待办。**

## 1. 现实代码与新的第一优先级

- `src/app/assistants/index.tsx`：现在还是有计数的 Cards，`New Assistant` 点击后只在页面展开 inline 编辑 Card；每行只有一个 8px 状态点，**不是头像**；`src/app/assistants/[id].tsx`：先显示 `Open conversation`/Start Coordinator 卡，再是 Goals/Tasks/Memory 管理长页，**还不符合点击联系人直达聊天**。
- `src/app/chat/[paneId].tsx` + `src/components/chat/chat-page-view.tsx` + `src/features/chat-web/controller.ts` 是现有 Provider Chat 事实源、操作控制器和唯一 React Chat HTML；不可复制到新的 AssistantChat 或 GroupChat 页面。
- `src/contracts/host-v3.ts`/`src/lib/host-client-v3.ts` 只能表达已有 Assistant/Coordinator/Task/Memory DTO，Group/Conversation/Avatar/MCPGrant/GoalProgress/RoutineReport 必须先有 Mac Go authoritative Host API + golden，再在手机同步 Zod。
- 原 macOS `internal/nativeui/assistants_section.go` 固定 iconAssistant，不是用户可识别的个人助理头像；`assistants_state.go` 的 bool newForm 被 `assistants_bridge.go` snapshot 读取即清除，`frontend/src/assistants/AssistantsPage.tsx` 仅根据 bool 变化打开 Sheet。桌面需先修事件投递，手机也应沿用**稳定 Create Intent**，不要依赖瞬时布尔标志。
- Mac resident Host `internal/hostd` 目前不等价于 GUI-independent Chat 能力：手机不因可以列出 Assistant 就当其可以发消息。

## 2. 手机完整 UX：像微信而不是像工作任务管理

~~~text
Assistants                              [+]
 [Chats] [Contacts]                       ← 列表/搜索
 (A) 研发助理             “测试仍在跑…” · ●1
 (👥) 发布协作群           “测试助理：…” · 2
 (T) 测试助理             “已经完成审查…”
        │
        + 点击 => ┌───────────────────────────────┐
                  │ < (A) 研发助理     [状态] [⋯] │
                  ├───────────────────────────────┤
                  │ 你：请帮我推进代码质量目标    │
                  │ A：我先检查…                │
                  │ [任务运行中 · 查看实际 Run]   │
                  │ A：已完成第一阶段，…          │
                  ├───────────────────────────────┤
                  │ [+] 发消息...          [➤]   │
                  └───────────────────────────────┘
~~~

- `+` 先开 Native ActionSheet/Popover，**只有** `New Assistant` / `New Group`。不能点一下直接展开 inline Card。
- **New Assistant Sheet**：姓名必填，头像、描述/一句职责、Preset 可选；创建成功有真实 assistantId 并直接推入 `/assistants/[id]` 空聊天页面，首次 Send 幂等启动/绑定真实 Herdr Coordinator，失败保留草稿。
- **New Group Sheet**：选 2–4 位**已存在**个人助理、可选群名与群头像，保存向 Go 新 Group API 请求真实 `groupId/conversationId`；成功直接打开 `/assistants/conversations/[conversationId]`。没有 Go Group Capability 时明确不可新建，避免假群聊。某个 Assistant 的旧普通 Pane/Session 不能被伪装为群组。
- 个人 Assistant 页头：头像/名字/正在工作状态/⋯。内容区只有 ChatPageView（等待/无聊天历史时明确 empty-state），不是 `Needs You/Watching/Tasks/Remembers` 管理长页。More Sheet 才有 Profile、Initial Prompt、Permissions、Agent & Model、MCP Servers、Memory、Goals、Routines、Activity、Files。
- Group 页头：成员叠头像、群名、人数/⋯；消息是多作者真实消息，每条有 authorAvatar/authorId/time/mention/reference；准确 @ 时才唤醒被点名的 Assistant，没有 @ 是存消息而不是自动跑所有 Agent。群任务卡/授权/来源可展开，点击成员可进其单聊。
- Chats 与 Contacts 的行：Assistant 圆形首字头像（对齐 Desktop 同一 identity）、Group 叠头像；可信最近**消息**摘要优先，其次真实状态，未读/NeedsYou 严格区分；多助理的 Peer DM 双头像、可作为后续协作层。用户设置图片支持安全受控 Avatar URL/fallback，不能裸露 Mac 的 file:// 路径。
- 返回、切换 A→B→Group、返回同一个会话保持每个 Conversation 的 draft/scroll/queue/pending/未读，不随全局 Mac Pane 的选择变化。群聊 Store 事实不等于 Provider Transcript，桥接层要按 conversation.kind 装载正确数据源。

## 3. 初始提示词、MCP 服务与目标 / 例行职责

### 初始提示词与记忆

`New Assistant` 可选从“通用助理 / PR Reviewer / 私人助理 / 研究助理”等 Preset 生成默认指令；新建后每位助理都有可修改的 `initialPrompt/rolePrompt`，保存为版本化的 Assistant Instructions（*不是*直接塞进 Approved Memory）。`Memory` 是另外的事实目录、可供 Owner 手动编辑、Agent 先 propose 后批准。手机只通过 Host 编辑受控 DTO，不直接访问 Mac 本地 Finder 文件。

### MCP Services（取代 Extensions Marketplace）

`⋯ → MCP Services`：已配置的 MCP Server 列表（名称、实际 Provider 可用性、连接/验证状态、Tools/Resources/Prompts 摘要）、本 Assistant enabled grants、工具白名单与操作审批边界；Add/Remove 时可跳 Mac Provider 的原配置界面，手机发受权请求。注意：MCP Server 可在 Solco 列表里“已登记”，但在当前 Herdr Provider/Agent Session “未实际绑定”，UI 必须如实说明。OAuth/API Token 只能留 Mac 安全存储，stdio server 需告知本机执行风险。

手机不引入 Lua/TS、自己的 Plugin Runtime、第二个 MCP 实现或第三套 Workflow 状态；Go/Provider/Herdr 是真正执行者。有关 Provider 的 MCP 配置必须经过准确 MCP compatibility/capability 探测，而不是 mobile 自己假定。

### Goal / Proactivity / Conversation receipts

- 用户对某 Assistant 说“接下来一周优化 X”，对话展示**持久 Goal Draft/Approved Goal**，有里程碑、成功标准和当前下一步；Assistant 有受限计划→拆分真实 Task/Worker→核验证据→遇阻重规划→回 Chat 汇报。
- “已收到/正在处理”只在 Host 确认消息已持久接收后作为**系统收据**出现，不能冒充模型说话；Assistant 自己生成的“我会先…”是真实模型答复。Task 状态、Need Approval、Run Error、Result 等使用系统事实卡；完成后 Coordinator 汇总并给清晰的回答、来源链接、下一步。
- 用户说“每天下午检查项目”，Assistant 可以先自动提交 Routine Draft（包含 timezone、触发、工作目标、工具、预算、批准/审批）；确认后仍由同一个 Go Automations Scheduler 调度。更改频率/启停/人工触发都要展示真实收据，不能只“口头承诺我记住了”。
- 主动回复是**进度事件驱动** + 可配置汇报时间/无进展超时，不按每 N 分钟机械刷消息；quiet hours、防重复/反循环、预算、失败恢复由 Mac Go Core 强制检查。手机只给可读结果和调节选项。

## 4. Host v3 建议 DTO/Capability 与路由

| 新能力 | 一对一/群聊手机如何使用 |
| --- | --- |
| `assistantAvatar` / `assistantProfileManage` | Host 返回头像版本引用或安全 HTTP 图片入口，稳定 assistantId；姓名变更不换默认色 |
| `assistantConversation` / `assistantGroupChat` | 单聊准确 Assistant→Herdr Coordinator，Group→Go Multi-author Conversation；read/ensure/send 分别 capability-gate |
| `assistantGroupManage` | Group 创建、成员授权、编辑名称/头像、移除/归档；所有修改 requestId/revision |
| `assistantInstructionsManage` / `assistantMCPManage` | Prompt/Policy/Model 与 MCP Server grants 的读取/更新；真实 Provider/Agent binding 状态 |
| `assistantGoalProgress` / `assistantRoutines` | GoalPlan/ProgressLedger/Routine Draft+Approval/Execution+Report，来源/下次检查/责任/Report delivery |
| `assistantMemoryManage` / `assistantMemoryFiles` | 原 SQLite authority 下的 Memory 文件 tree/内容版本/外部编辑冲突，手机不拿绝对路径 |
| `assistantConversationEvents` | scoped chat facts + Provider-authored reply，messageId/authorId/sourceRef 的真实区分 |
| `assistantProactivity` | 可设置 proactive level、quietHours、followUpPolicy/report cadence、预算，用于 Owner 管理 |

**提议路由（不是现有 API）**：
- `POST /api/v3/personal-agent/assistants` 仍是个人助理；新增 profile/instructions 的 versioned edit。
- `POST /api/v3/personal-agent/groups`、`GET .../groups/{groupId}`、`POST .../groups/{groupId}/messages`，与人/助理私聊 conversation binding/API 独立。
- `GET/POST /api/v3/personal-agent/assistants/{id}/mcp-grants`；`GET /api/v3/personal-agent/mcp-catalog`（由 Mac Provider/Agent 检测所得，不包含 token）。
- `GET/POST /api/v3/personal-agent/assistants/{id}/goals/{goalId}/plan`、`.../progress`、`.../routines`；报告走真实 Report/Message API，不伪造 Herdr Transcript。
- 任何写操作要求 stable `requestId`、server expectedRevision/permission/hostInstance 复验；不靠 UI 隐藏控制权限。新 Host golden 测试是手机 Zod 唯一 wire truth，旧 Host 和 resident Host 的每个功能分别明确降级。

## 5. 交付序列（与桌面 U0～U5 同步）

| 批次 | 手机范围 | 关键验收 |
| --- | --- | --- |
| **M-U0** | Chats/Contacts 列表、圆形 Assistant 头像和叠 Group 头像、`+` 两项菜单、New Assistant Sheet | 连续点击/失败保留表单/两次创建幂等/真实 avatar |
| **M-U1** | `assistants/[id]` 直接 ChatPageView + Group 聊天路由 + @/Reply/真实消息作者 | 进入页面像打开微信聊天，首次发送不重复、A/B/Group 不串线 |
| **M-U2** | 初始提示词编辑、Agent 模型设置、MCP Services 授权/状态 | 当前 Provider Session 工具可见与配置一致，不支持要准确显示 |
| **M-U3** | GoalPlan/Commitment/Task/Progress 状态卡、回复与主动汇报、跨 Assistant 调度 | 用户看到每个目标的“下一步/进行中/阻塞/已核验”，不用跑去仪表盘催进度 |
| **M-U4** | Chat 创建 Routine Draft/审批/查看 Schedule/Run/报告 | 计划真实记录在 Mac Go 且只有一个调度源 |
| **M-U5** | Memory 文件/建议/整理、Persona 个性化、主动等级/QuietHours | 改记忆不窜、长期承诺不丢，断线如实反馈 |
| **TODO** | Go Workflow 框架是否需要、SDK 选择、补偿/状态持久化 | 不进行手机端“通用工作流画布”开发 |

## 6. 联合验证

- 最小入口：Android/iOS 点击现有助理直接打开 Chat，点击群聊直接打开群 Chat；New Group 真正创建 Go Group，旧 Host 没 Group endpoint 时明确不可用。
- 验收桌面 `MU-01～MU-23`，特别是共享消息/头像/截图、创建幂等、A/B/Group 快切、远端独立导航、Provider 容量、MCP permission/credential、Routine 对旧 YAML 无双执行，以及“收到 → 计划 → 分派 → 核验 → 回复”的完整闭环。
- Desktop Host 实际 Go golden → `pnpm sync:fixtures` + `pnpm check:fixtures`；共享 Chat page Desktop `bun run build:mobile` → `pnpm sync:chat-page`/`pnpm check:chat-page`；手机 `pnpm typecheck` / `pnpm lint` / `pnpm test` / `pnpm export:web`；Android Development Build 和 Mac MyGo WKWebView 实机无伪造可用性声明。
- 保护当前工作区和真实 Agent/Repo：测试使用隔离 HOME/Herdr 环境；未验证的 UI 和 API 明确标 Proposed，不静默发布市场/第三方 MCP 接入能力。

**产品约束**：聊天优先、MCP first、Goal 能持续推进、Routine 经授权定期执行、每个承诺有事实回执、群聊是多人会话而非新的 Agent；不重新开发一套 Plugin/Workflow/Chat 运行时。
