# Solco Mobile — Personal Agent Platform V3 配套计划

> **状态：2026-11-04 V3 资料/模型/记忆/权限功能底稿；最新消息式 Assistant/Group/MCP/Goal 产品与交付顺序见 `docs/assistants-messenger-agent-mobile-plan.md`。旧 Marketplace 三类别、Agent Template 与 Lua/TS runtime 假设已撤回，Go Workflow 框架暂不实施。**
> **桌面/Go 主方案**：`solco/docs/assistants-personal-agent-platform-plan.md`（V3-0～V3-7，AC-01～AC-20）；用户体验继续以 `solco/docs/assistants-chat-first-redesign.md` 和 `solco/docs/assistants-conversation-product-spec.md` 为基线。手机是**已配对 Mac Host 的纯客户端**，不直接运行 Lua/TS、OAuth 本地账号或 Go Scheduler，不生成第二份 Chat 页面。之前的 `docs/assistants-chat-first-mobile-plan.md` 保留 Chat-first 改造要求；本计划扩展「⋯ 更多」的能力中心。

## 1. 当前事实与目标差距

- `src/app/assistants/[id].tsx` 当前仍以 Conversation → Coordinator Agent 选择/启动、Needs You/Watching/Tasks/Remembers 长 ScrollView 为主；Owner 可以 Rename，但不能完整设置 Description/RolePrompt/ACL、模型思考强度、记忆文件夹双向编辑、Routine/MCP。
- `src/contracts/host-v3.ts` 的 Assistant Schema 已有 Description/RolePrompt/Scope/WorkspaceRefs/DefaultPolicy，却没有 AssistantAgentConfig/PermissionGrants/Routine/MCPServerGrant/MemoryFile/ContextSnapshot 的受控 DTO；只是 TypeScript 类型存在**不代表对应服务端写 API 可用**。
- Provider Chat 的 `src/app/chat/[paneId].tsx` 和 `src/components/chat/chat-page-view.tsx` 已有单源 Chat 实现，不应把更多功能写成第二个 Assistant 聊天引擎。
- `src/features/host/queries-v3.ts` 有 Assistant Detail/Inbox/Write/WS invalidation；按此增加 config/memory/routine/market 的按需查询与乐观 UI 禁用、服务端拒绝反馈。
- `solco/internal/hostd` 已有 Go resident Host，但 **GUI 退出后不一定暴露完整 Chat/Files/Git**；手机能力按 bootstrap 和精确 scope 展示，不能因为能读取 Assistant 资料就虚报能发消息或访问 Mac Finder。

## 2. 目标更多菜单（保持聊天为主）

| 入口 | 手机端交互 | 写入语义 |
| --- | --- | --- |
| **Profile** | 姓名、描述、头像、Assistant 职责、风格、简短公开介绍；独立修改页 | Host Profile mutation + expectedRevision |
| **Permissions** | 可读 Workspace/Repo、允许的工具/联网/外部 app/协作对象、审批策略、主动级别与预算 | 每个改动服务端校验 ACL/policy；撤销立即影响新行动 |
| **Agent & Model** | 当前 Coordinator + Worker 行（运行/待确认/失败）、真实 Agent Kind/Provider/Model/思考强度、默认设置 | 真实 Provider catalog；改默认不暗中重启当前 Run，必要时显示 Restart 确认 |
| **Memory** | 已批准/待确认/用户笔记、手动 Add/Edit/Forget、版本与来源；**浏览 Mac 上该 Assistant 的记忆文件夹** | Host memory file/list/read/write；手机不是 Finder，不能直接访问本地路径 |
| **Routines & Automations** | 我的例行职责、下次运行、上次结果、当前 Workflow、审批/暂停/手动触发、查看 Worker/Run | Mac Go 单 Scheduler；所有动作需 revision/requestId |
| **MCP Services** | 查看 Provider 可用 MCP Servers/Tools/Resources/Prompts、按 Assistant 连接/授权/撤销、真实绑定状态 | 手机只向 Mac Host 请求配置与 grants；OAuth/Keychain/stdio 进程留 Mac，手机不执行脚本 |
| **Context & Skills** | 本轮注入的 Memory ID/版本和 Workspace/工具范围、可读取的模型上下文使用值 | Host 只读，实际模型可提供才显示 |
| **Activity & Audit** | 主动原因、来源、费用/预算、结果证据、下次跟进、通知时段 | Host authoritative Run/Rule/Event，不伪造 AI 回复 |

### 手机 Memory Folder 交互

- 主界面 `Memory`：搜索、已批准、待确认、Owner notes、查看上次整理日期。
- `Browse folder`：Host 返回**本 Assistant 内的虚拟目录树**和受控 fileId / content / revision；手机列表/Markdown 编辑器分层浏览、按文件修改。只有 Mac 桌面端支持真正 **Open in Finder**，手机端可在授权情况下「下载/导出该文件」，不请求或显示完整 Mac 私人绝对路径。
- 手动创建可以「记住一件事」或「增加一个笔记」；Owner 在 UI 明确确认后调用 Go store 的 direct add/correct（候选/批准分别是不同操作）。外部 Finder 编辑产生待确认同步差异时手机也能 review diff/Accept/Reject，但不把文件事件当作用户身份认证。
- 编辑先显示现有 revision/来源，保存遇到 409 stale 提供 Reload/Compare；断线不在本地声称保存成功，不把私有 Memory 自动同步到其他 Assistant。
- 「整理记忆」显示下一次执行、预算/成本、候选数量与可审阅的去重/合并/忘记建议；默认**不允许 Assistant 自动删记忆**。

### 手机 Agent/Provider/Model 配置

- 列表实时区分「**正在运行**」与「**下次使用的默认配置**」。
- 选择 Agent Kind（Claude/Codex/Pi 等）后，按 Host catalog 获取该 Kind 支持的 Provider/Model/Effort/限制；不支持的 Reasoning 不展示虚假选项。
- 主 Agent 与 Worker task type 可单独设置缺省；更改默认只影响下一次启动，当前 Agent 只能显式确认中断/重开，返回后需刷新真实 Herdr 运行事实。
- API credential 仍由 Mac 的 Credential Store 管理；手机不读取或复制密钥，未配置时说明原因并提供 Mac 设置入口。

### 手机 Routine/MCP 交互

- 新建 Routine：一句「长期职责」→ 选择来源/工作流 → 设置触发时间（明确时区/DST）→ 预算/允许行动/审批 → Review Draft → Enable。默认创建草案，**不能因为 Chat 里出现“每天帮我”就自动执行高权限动作**。
- 显示 Automation 的 ownerAssistant、requestedBy、triggeredBy、上一次 WorkflowRun/WorkerRun 与 reportConversationId；Owner 可在详情直接回到对应 Assistant Chat 看真正报告/事实卡。
- 插件列表就是 **MCP Services Catalog**（已配置、可连接、已授权到当前 Assistant、当前 Provider Session 实际可用）；可选 **Assistant Preset** 属于 New Assistant 创建界面，不是独立 Agent Plugin。
- MCP Server 在 Mac/Provider 受控配置，按 Assistant 授权 Tools/Resources/Prompts；本轮不设计 Lua/TS Marketplace 安装包或独立 Plugin Runtime，工作流框架待后期研究。

## 3. 提议的 Host v3 能力与 DTO（服务端先实现）

**建议 capability 细分**：`assistantProfileManage`、`assistantAgentConfig`、`assistantMemoryFiles`、`assistantMemoryManage`、`assistantRoutines`、`assistantMCPManage`。现有 `personalAgent`/`personalAgentManage` 不被废弃。即便 capability 为 true，每次写请求仍由 Host 和 Go Core 校验当前设备 scope/assistantId/policy/revision。

| 端点族（建议，尚未上线） | 作用 |
| --- | --- |
| `GET/POST /api/v3/personal-agent/assistants/{id}/profile` | Profile/Style/Permissions，带 requestId+expectedRevision |
| `GET/POST /api/v3/personal-agent/assistants/{id}/agent-config` | 读写主/Worker Agent Kind、Provider、Model、Effort、运行预算 |
| `GET /api/v3/personal-agent/agent-catalog` | 真实可用 Provider/Model/Effort/兼容性；Credential 的可用状态而非原文 |
| `GET /api/v3/personal-agent/assistants/{id}/agents` | 当前 Coordinator/Worker Runs，真实 Herdr Pane refs，状态/当前配置 |
| `GET /api/v3/personal-agent/assistants/{id}/memory/files` | 只读文件树，fileId 和版本；任何手机路径参数不能越过本 Assistant |
| `GET/POST /api/v3/personal-agent/assistants/{id}/memory/files/{fileId}` | 内容与修订后的保存/冲突/待确认导入 |
| `GET/POST /api/v3/personal-agent/assistants/{id}/memory/items/...` | 现有 Memory 的 add/correct/forget/approve/share，带来源与审阅 |
| `GET/POST /api/v3/personal-agent/assistants/{id}/routines/...` | 草案、批准、暂停、规则绑定、执行/报告历史 |
| `GET /api/v3/personal-agent/mcp-catalog` | 从 Mac 真实 Agent/Provider 配置获取 MCP server 能力，不暴露凭据 |
| `GET/POST /api/v3/personal-agent/assistants/{id}/mcp-grants` | 每位个人助理 MCP Server/Tool 权限与当前 Session binding 校验；不启动新 Plugin Runtime |
| `GET /api/v3/personal-agent/assistants/{id}/initiative-history` | 主动检查/通知/总结的可追溯源与成本 |

**契约原则**：Host 的 Go golden 是唯一 wire truth；手机按 golden 同步 Zod schema 与 `host-client-v3`。新增能力应以功能粒度可选，旧 Host/resident Host 只读降级；私有 Memory/笔记/插件 token 不写入设备通知、日志或 WebSocket event body。

## 4. 手机分批交付（随桌面 V3 保持同批次）

| 阶段 | 手机端交付 |
| --- | --- |
| **M3-1** | 更多菜单 Profile/Permissions、Agent & Model 的读写、运行实例查看，类型/修订/能力门禁测试 |
| **M3-2** | Memory 文件树/Markdown 增删改/候选审阅/整理建议；断线/并发冲突测试 |
| **M3-3** | Routine/Automations 归属页、建草案/审批/暂停/启动、Run 证据与返回 Assistant Chat |
| **M3-4** | MCP 服务目录/授权/真实 Provider 会话绑定、个人助理 Preset |
| **M3-5** | Goal 主动推进与 Routine 报告闭环；复杂 Go Workflow 框架保持 Deferred，不开发手机通用编排 UI |
| **M3-6** | 主动消息/QuietHours/为什么提醒/成本预算/长期人格与 Context 可解释性 |

## 5. 验收与跨仓同步

- 测试重点覆盖桌面主文档的 **AC-01～AC-20**，尤其是跨设备审批/修订、Provider 模型选择、Memory A/B 隔离、旧自动化去重、MCP Server 受控绑定、通知频控。
- Desktop Mac Host 先产实际 JSON golden；移动用 `pnpm sync:fixtures`、`pnpm check:fixtures`、`pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm export:web`。如 Shared Chat 代码有变化，桌面先 `bun run build:mobile`，手机 `pnpm sync:chat-page` / `pnpm check:chat-page`；不能复制 `ChatPageView`。
- Mac 需要隔离 HOME/Herdr scratch repos 的 E2E；手机须 Android Development Build + macOS MyGo WKWebView 双端验证真正弹窗、文件保存、回退路径、Chat 草稿/Scroll 保持、离线/撤销设备。
- 只改 docs 的本轮不能算移动平台或 API 已实现；代码/截图/金样/实机记录作为实际闭环证据。

**最新优先级**：手机点击 Assistant/Group 直接聊天，稳定双项新建菜单与头像；再做初始指令/Agent/MCP、Goal 回响、Routine 自动化与记忆。详见 `docs/assistants-messenger-agent-mobile-plan.md`。
