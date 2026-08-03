# 阶段 14：受控的 MCP Client 与三类 Server 原语

## 1. 阶段目标

让 CtrlZebra 在不削弱现有 Agent Loop、安全审批、取消、上下文预算和恢复语义的前提下，
连接一个由用户显式配置的本地 `stdio` MCP Server，并支持 MCP Tools、Resources（含 Resource
Templates）和 Prompts 三类主要 Server 原语。

阶段完成后的最小用户路径是：配置本地服务器 → 显式连接并确认启动操作 → 查看连接与能力 →
用户浏览并附加有界 Resource 或主动选择 Prompt → 模型提出 MCP Tool Call → 用户查看服务器、
Tool、参数和外部副作用警告并逐次批准 → 收到有界结果 → 取消 Run 或断开服务器后不再接受
迟到输出、上下文更新和副作用。

本阶段以 MCP `2026-07-28` 规范作为设计和兼容性评审基线。首期只接受该精确协议版本，
不自动降级到旧协议或接受未知未来版本。每个涉及官方 SDK 或协议细节的实现任务开始前仍须
通过 Context7 核对当前文档、稳定版本和勘误，并把采用的 SDK 与协议版本固定在依赖和测试
证据中。

## 2. 前置条件与固定范围

### 2.1 前置条件

- 阶段 0–13 已完成并合入 `main`。
- Core Tool Registry、Tool Executor、Approval Policy、Agent 状态机、取消和 Tool Result
  限额继续作为唯一运行时控制边界。
- Extension 已有 Workspace Trust、直接进程启动、最小环境、进程树终止、SecretStorage、
  结构化诊断和 Disposable 所有权基础。
- T1401 的约束门禁必须在任何 MCP 依赖、代码、配置或协议字段进入实现分支前独立完成并合入。

### 2.2 本阶段包含

- 一个本地 `stdio` MCP Server 的用户级显式配置、连接、断开和状态反馈。
- MCP 初始化、协议版本与能力协商、正常操作、取消和关闭生命周期。
- `tools/list` 的完整分页、可选 `notifications/tools/list_changed` 刷新和 `tools/call`。
- MCP Tool 到 CtrlZebra Tool 契约的受控适配、确定性命名和冲突处理。
- 每次 MCP Tool Call 的严格参数校验、逐操作审批、取消、结果归一化和资源限额。
- `resources/list`、`resources/templates/list`、`resources/read` 和相应列表变更通知；只允许用户
  或 Host 明确选择的有界文本 Resource 进入普通不可信上下文。
- `prompts/list`、`prompts/get` 和 Prompt 列表变更通知；Prompt 只由用户主动选择、预览和确认，
  不提升为 System 指令，也不自动调用 Tool 或读取 Resource。
- Server、Tool、Resource、Prompt、调用状态和安全错误的 Webview 展示与可访问用户路径。
- 使用受控 fixture server 的单元、适配器集成、Extension 集成和 VSIX 烟雾验证。

### 2.3 本阶段明确排除

- Streamable HTTP、旧 HTTP+SSE 回退、远程服务器、OAuth 和其他远程鉴权。
- Sampling、Elicitation、Roots、Tasks、`input_required` 自动履行/手工续轮和服务器发起的未声明
  Client 能力。
- Resource subscription/updated 推送、自动刷新已附加上下文和后台预取。
- 图片、音频、二进制 Blob、嵌入 Resource、Resource Link 或其他多模态内容。
- MCP Server 托管、自动下载或安装、市场、推荐目录、工作区共享配置和云同步。
- 自动连接、激活时启动、恢复 Session 时重启、静默重启、健康轮询或失败自动重试。
- 由模型、Prompt、工作区文件、Webview 消息或 MCP Server 决定服务器命令、环境、cwd、
  CtrlZebra Tool 风险或审批策略。
- Plan/Act、自定义 Modes、更多模型 Provider、Git 自动化、语义索引和多 Agent。

## 3. 阶段固定原则

1. MCP 是外部协议边界，不是 Core 的第二套 Agent Runtime。MCP Client 和 Server 不得改变
   Session 状态、继续模型循环、批准操作、决定重试或直接驱动 Webview。
2. MCP Server、Tool 描述、JSON Schema、annotations、结果、日志和错误均不可信。Server
   声明的只读、幂等或破坏性提示只能用于展示，不能降低 CtrlZebra 的可信风险等级。
3. 首期每个 MCP Tool 采用保守的外部执行策略。风险归类和审批展示的精确公共契约由 T1401
   固化；最低要求是每次调用都需要绑定服务器身份、Tool 名称和已校验参数的全新单次批准。
4. 服务器启动是独立于 `run_command` 的长生命周期宿主操作。只允许用户显式触发，要求可信
   工作区，绑定完整 executable、ordered args、canonical cwd 和最小环境，并拥有有界、可确认
   的完整进程树清理。
5. 激活、Session 恢复和模型输出不得自动启动或重连 Server。断开、失败、取消或 Extension
   释放后，迟到响应、通知、Tool Result 和副作用均不得进入 Core、持久化或 Webview。
6. 首期只接受协议允许且 CtrlZebra 明确支持的文本内容与严格 JSON structured content。
   其他内容类型产生稳定的“不支持”结果，不静默丢弃、字符串化或扩展 CSP。
7. 所有收集器在构造完整值前执行页数、Tool 数、Schema、消息、stderr、结果和序列化上限；
   MCP 输出仍受现有 1 MiB Tool Result 上限以及更窄的上下文预算限制。
8. MCP SDK 类型、JSON-RPC 错误、进程对象和第三方异常保持在 MCP/Extension 适配边界内。
   Core、Protocol、持久化和 Webview 只接收 CtrlZebra 自有的严格、可序列化值。
9. Resources 是应用/用户控制的上下文，不是可执行 Tool。读取结果保持普通不可信用户内容，
   服从 URI、MIME、文本、条目、字节和 Context Budget 限额，不能成为 System 指令或授权来源。
10. Prompts 是用户控制的模板。服务器返回的消息必须先有界校验并向用户预览；只有用户明确
    确认后才能进入当前输入流程，且不得携带隐藏 System 权限、自动副作用或持久授权。
11. `2026-07-28` 规范或 SDK 中存在但未获阶段授权的能力保持未声明、未注册、不可达。Server
    广告额外能力不构成授权；对未声明 Client 能力的请求使用稳定的“不支持”结果，不能触发
    Host、Provider、Workspace、审批或持久化操作。
12. SDK Client 必须将版本协商固定为 `2026-07-28` 并关闭 `input_required` 自动履行；不得通过
    SDK 默认值、按调用选项或隐藏 handler 自动重试原请求、回传 opaque request state，或引入
    Roots、Sampling、Elicitation 和 Tasks 的间接路径。

## 4. 任务顺序

`T1401 → T1402 → T1403 → T1404 → T1405 → T1406 → T1407 → T1408 → T1409`

每次只执行一个任务。后续任务不得在前置任务的公共契约或门禁 PR 尚未合入时提前实现。

## 5. 任务规格

### T1401：建立 MCP Client 与外部 Tool 的产品、安全和跨边界契约

**目标**：在引入依赖和代码前，决定长期模块边界并把 MCP 的协议、配置、生命周期、风险、
审批、取消、限额、持久化和 UX 规则写入唯一权威文档。

**前置条件**：阶段 14 已在路线图和产品基础中获准。

**产物**：

- 更新 `docs/architecture.md`：Host/Client/Server 所有权、建议包边界和依赖方向、懒初始化、
  一连接一所有者、能力协商、取消、断开与 SDK 隔离。
- 更新 `docs/security.md`：用户级配置来源、Workspace Trust、stdio spawn、最小环境、凭据排除、
  Server/Tool 不可信、逐调用审批、结果/日志限额和进程树清理。
- 更新 `docs/protocol.md`：Webview/Extension 的服务器与 Tool 状态 DTO、稳定错误分类、严格校验、
  Tool 命名与外部身份映射，以及 Resource/Prompt 的有界投影；不得直接暴露 JSON-RPC 或 SDK
  类型。
- 更新 `docs/persistence.md`：Server 身份、Tool Call/Result、已附加 Resource 快照和已确认
  Prompt 的最小持久化投影、兼容性、恢复与禁止自动重连/重放规则。
- 更新 `docs/ux.md` 与 `docs/webview.md`：配置、连接、发现、审批、失败、取消和断开路径，以及
  键盘、窄侧栏、主题和 live-region 要求。
- 按长期架构影响新增 ADR，记录至少“独立 MCP 包/Extension 内适配器”的取舍、为何首期选择
  stdio + 三类 Server 原语，以及未来增加 HTTP、Client 原语或多模态时的变更边界。
- 采用官方 `@modelcontextprotocol/client`，首个实现精确固定 `2.0.0`；记录升级策略、公开
  Transport/validator 子路径、JSON Schema 校验策略，以及协议 `2026-07-28` 兼容矩阵。

**测试**：文档链接检查；术语、能力和排除项一致性搜索；依赖图与安全矩阵人工审阅。

**不包含**：依赖安装、package/config 修改、协议 Schema、MCP 客户端或 UI 代码。

**约束门禁**：必须作为独立 docs-only PR 审查并合入，之后才允许 T1402 开始。

### T1402：实现 MCP Client 契约与可测试的 stdio 生命周期

**目标**：按照 T1401 的模块决策建立 MCP Client 边界，实现初始化、能力协商、请求关联、取消、
关闭和故障清理，不接入 Agent Tool Registry。

**前置条件**：T1401 已完成；采用的 SDK、协议版本和依赖方向已固定。

**产物**：

- MCP Client 自有接口、稳定状态和错误分类；第三方 SDK/JSON-RPC 类型不越界。
- 官方 Client 使用固定版本协商 `pin: "2026-07-28"` 并关闭 `input_required` 自动履行；生产
  transport 包装 Extension 注入端口，不使用 SDK 自带的进程所有权。
- 注入式 stdio transport/process port 与确定性的 fixture transport；生产进程创建仍由
  Extension Host adapter 拥有。
- `initialize → initialized → operation → disconnect` 生命周期、协议/能力不兼容失败、请求取消、
  幂等 dispose、stderr 有界收集和迟到消息丢弃。
- 不声明 Sampling、Elicitation、Roots、Tasks 或其他未实现 Client capability。

**测试**：正常精确版本协商；旧版/未来版/能力不兼容；`input_required` 不自动履行；畸形消息；
并发请求关联；取消后无输出；Server 提前退出；初始化失败与 dispose 竞态；全部异步资源清理。

**不包含**：真实用户配置、Tool 发现/调用、Core Registry、Webview、自动重试和 HTTP transport。

### T1403：接入用户级服务器配置与 Extension 生命周期

**目标**：让用户显式配置、启动和断开一个本地 stdio Server，同时不允许工作区或模型控制
进程能力。

**前置条件**：T1402 已完成；T1401 的配置和 spawn 安全契约已可实现。

**产物**：

- 严格、版本化的用户级服务器配置解析；首期只允许一个服务器和固定的 executable、ordered
  args、canonical selected-workspace cwd，以及文档允许的最小环境。
- 显式连接/断开命令，启动前展示并授权精确进程操作；不在激活、恢复或模型请求时自动启动。
- Workspace Trust 重检、并发连接合并、连接所有权、Server 退出、取消、窗口/Extension 释放和
  完整进程树终止。
- 固定的安全错误与有界诊断，不记录命令环境、Tool 内容、stdout JSON-RPC、stderr 原文或凭据。

**测试**：合法配置；未知字段和危险参数；不可信工作区；审批拒绝/过期/失效；并发连接；异常
退出；取消与 dispose；无法确认终止；激活和 Session 恢复不启动 Server。

**不包含**：Secret 注入、远程连接、多服务器、工作区配置、Tool Registry 和 UI 管理页面。

### T1404：发现并适配 MCP Tools

**目标**：完整发现服务器 Tools，并用确定性、无冲突、可撤销的方式投影为 Core 可注册的外部
Tool 定义，但不开放执行。

**前置条件**：T1403 已完成；Server 身份和连接生命周期稳定。

**产物**：

- `tools/list` 全分页、页数/Tool 数/Schema 大小上限，以及可选 `list_changed` 的串行刷新。
- Server 身份 + MCP Tool 名称到 CtrlZebra lower `snake_case` 名称的确定性映射、长度限制、
  collision/rename/removal 处理和内置 Tool 隔离。
- 从 `unknown` 验证 Tool descriptor 和 JSON Schema；拒绝不支持、递归失控、过大或含冲突定义
  的列表，不部分注册可疑快照。
- 动态 Registry snapshot 的原子替换与连接世代绑定；断开或刷新后旧定义不可调用。
- annotations、描述、图标 URL 和 Server metadata 保持不可信，不能决定风险、授权或远程加载。

**测试**：空列表；多页；重复 cursor；超限；畸形 Schema；命名冲突；内置 Tool 冲突；
`list_changed` 竞态；断开刷新；取消后无 Registry 变化。

**不包含**：`tools/call`、模型循环、审批、Resources、Prompts、远程图标加载和 Webview 管理。

### T1405：通过现有 Agent Loop 安全调用 MCP Tools

**目标**：让模型发现并调用已注册的 MCP Tools，同时所有调用服从现有 Core Policy、逐操作审批、
取消、重复检测、结果限额和 Session 状态机。

**前置条件**：T1404 已完成；T1401 的风险和审批契约已实现。

**产物**：

- 使用可信 Registry 定义对模型参数进行 Tool 专属 JSON Schema 校验，并绑定当前连接世代。
- 每次调用生成全新 Approval Request，绑定 Session、Run、Tool Call、Server 身份、MCP Tool
  名称、已校验参数、连接世代、用户展示和过期时间；Server annotations 不能降低风险。
- 审批消费后执行 `tools/call`；取消向 MCP 请求传播并立即关闭 Core 结果接收门，迟到返回无
  Tool Result、持久化、模型继续或 UI 副作用。
- 只归一化受支持的文本与 JSON structured content；验证声明的 output schema，流式实施更窄
  限额，拒绝 unsupported/malformed/oversized 内容并映射稳定错误。
- Tool Call/Result 继续形成不可分割的上下文与持久化单元，沿用重复调用检测和最大循环预算。

**测试**：正常调用；参数无效；未知/已移除 Tool；连接世代改变；审批拒绝/过期/单次消费；
Server Tool error；output schema 不匹配；不支持内容；超限；取消/断开竞态；重复调用门禁；
`input_required` 无履行或重试；内置 Tool 回归。

**不包含**：自动批准、批量授权、权限记忆、Server 控制风险、并行 Tool Calls、Tasks 和重试。

### T1406：实现有界的 MCP Resources 上下文

**目标**：让用户浏览并读取服务器暴露的文本 Resources 和 Resource Templates，并把明确选择的
内容作为普通不可信上下文加入当前请求，而不把 Resource 伪装成 Tool 或 System 指令。

**前置条件**：T1403 已完成；T1401 已定义 Resource URI、内容、Protocol 投影、上下文预算和
持久化边界。

**产物**：

- `resources/list` 与 `resources/templates/list` 全分页、页数/条目数/descriptor/URI/template
  上限，以及可选列表变更通知的原子刷新。
- 严格的 URI 和 template argument 校验；Server URI 保持外部资源身份，不转换为已授权的
  Workspace URI，也不绕过 Workspace Scope。
- 用户明确选择后执行 `resources/read`；仅接受受支持 MIME 的有界、良构 Unicode 文本内容，
  拒绝 Blob、图片、音频、嵌入内容和超限响应。
- Resource 内容带 Server、URI、MIME、截断和来源投影进入 Files/外部上下文预算；它不是
  System 消息、Tool Result、审批或可信事实，不能覆盖最近用户意图。
- 列表变更或断开不会静默替换已构建请求中的快照；取消后无迟到上下文、持久化或 UI 更新。

**测试**：空列表；多页；重复 cursor；模板参数缺失/多余；危险或过长 URI；不支持 MIME；
无效 Unicode；多内容项；超限/截断；列表变更竞态；断开/取消；Prompt injection 文本保持普通
不可信上下文；`input_required` 无履行或重试；现有 Files budget 回归。

**不包含**：subscription/updated、自动刷新、后台预取、模型自主选取 Resource、二进制或多模态、
把 MCP URI 映射为本地工作区授权。

### T1407：实现用户控制的 MCP Prompts

**目标**：让用户发现、选择、填写、预览并确认服务器 Prompt，把受支持的返回消息加入当前输入
流程，同时保持用户控制和原有角色/安全边界。

**前置条件**：T1403 已完成；T1401 已定义 Prompt 参数、消息角色、内容、Protocol、持久化和
用户确认语义。

**产物**：

- `prompts/list` 全分页、条目/参数/描述上限和可选列表变更通知的原子刷新。
- 严格参数表单和 `prompts/get`；Prompt 名称、参数和返回消息均从 `unknown` 校验并受硬上限。
- 仅支持文本 PromptMessage；拒绝图片、音频、嵌入 Resource、Resource Link 和未知角色/内容。
- 用户在发送前看到 Server 来源、Prompt 名称、参数和完整有界文本，并明确确认；Server 返回
  内容不能成为隐藏 System 指令、自动发送、调用 Tool、读取 Resource 或授予权限。
- 取消、Prompt 列表变更、连接世代变化和断开会使未确认预览失效；确认后的内容按 T1401
  决定的普通对话投影进入当前 Run 和持久化，不保留可执行模板能力。

**测试**：空列表；多页；重复/畸形参数；缺失必填值；超限；未知内容类型；恶意指令文本；
预览确认/取消；列表和连接世代竞态；断开后失效；`input_required` 无履行或重试；键盘流程所需
store 行为。

**不包含**：自动运行 Prompt、slash-command 公共兼容承诺、System 角色提升、Prompt 链、模板
持久授权、自动 Tool/Resource 使用和多模态。

### T1408：完成 MCP Server、Tools、Resources 与 Prompts 的可访问体验

**目标**：把三类原语的配置、连接、发现、选择、调用、审批、错误、取消和断开状态完整呈现，
同时保持聊天为默认视觉焦点。

**前置条件**：T1405–T1407 已完成；所有 Extension-to-Webview 状态和用户意图均已有严格
Protocol Schema。

**产物**：

- 渐进披露的服务器配置说明、显式连接/断开入口、能力与连接状态，以及不阻塞普通聊天的错误
  恢复操作。
- MCP Tool 卡显示可识别的 Server 来源、动作、参数、运行/取消/失败/截断状态；待审批时沿用
  Inline Approval Fusion，并明确外部 Server 的未知副作用边界。
- Resource 浏览、模板参数、读取预览、来源/MIME/截断和附加/移除交互；Resource 内容不直接
  作为 HTML、Markdown、链接、命令或 URI 动作执行。
- Prompt 浏览、参数表单、完整文本预览、确认/取消和失效状态；不允许远程图标或内容扩大 CSP。
- 键盘、焦点、live region、约 300px、200% 缩放、长内容和四类 VS Code 主题验收。

**测试**：Protocol Schema、Webview store/component、来源和风险非颜色表达、焦点/选择保持、
状态去重、窄侧栏/缩放/主题、取消/断开/列表刷新后的 stale state 清理，以及普通聊天回归。

**不包含**：多服务器管理、自动安装、市场、远程资源渲染、Markdown/HTML Prompt 执行和阶段
排除能力。

### T1409：完成端到端验证、文档与发布门禁

**目标**：以受控 fixture server 证明 stdio 生命周期和 Tools、Resources、Prompts 三条用户
路径可发布，并完成用户文档、隐私与打包约束。

**前置条件**：T1408 已完成；阶段功能和用户体验均已进入候选发布状态。

**产物**：

- 固定的本地 fixture MCP Server，覆盖生命周期、三类 list 分页/list_changed、Tool 调用、
  Resource/template 读取、Prompt/get、错误、取消、断开和清理；测试不访问真实网络、不读开发者
  配置、不使用真实凭据。
- Extension 集成与 VSIX smoke 覆盖显式连接、三类原语的最小用户路径、逐 Tool 审批、断开和
  完整进程树清理。
- README、隐私说明、配置说明、故障恢复、已知限制、打包策略和 release checklist 更新。
- VSIX 产物不包含 fixture Server、凭据、缓存、原始 MCP 日志、用户配置或未审查可执行文件。

**测试**：完整 unit/component/adapter/Extension integration、typecheck、Biome、构建、VSIX 打包与
烟雾矩阵；人工验证 Tools、Resources、Prompts、取消、失败、重启和不可信工作区路径；确认无
迟到 UI、模型循环、上下文注入、持久化或进程残留。

**不包含**：HTTP、OAuth、多服务器、自动安装、市场、多模态、Client 原语和后续候选能力。

## 6. 阶段门禁

阶段 14 只有同时满足以下条件才算完成：

- T1401–T1409 全部完成并通过各自 PR 合入 `main`。
- MCP 依赖与协议版本固定，官方规范差异和已知限制有可追溯记录。
- Core 仍不依赖 Node.js、VS Code 或 MCP SDK；Extension 仍是进程、配置、SecretStorage、
  Workspace Trust 和宿主生命周期所有者。
- 激活、Session 恢复、模型输出和工作区内容均不能启动、重配或扩大 MCP Server 能力。
- 每次外部 Tool 调用都经过可信参数校验和精确单次审批；Server metadata/annotations 不授权。
- Resource 只在用户/Host 明确选择后作为有界普通上下文进入请求；Prompt 只在用户预览确认后
  进入输入流程，二者都不能获得 System、Tool、审批或持久授权语义。
- 取消、断开、Server 退出和 Extension 释放后没有迟到结果、模型继续、持久化、UI 更新或存活
  的子进程树。
- Tool 列表、Schema、输入、输出、stderr、日志和序列化值均在构造完整值前受硬上限约束。
- 所有自动化测试、repository-wide check、VSIX 打包、人工用户路径和可访问性矩阵通过。
- 阶段 2.3 的排除项没有通过“兼容”或“顺手支持”进入产物。

## 7. 后续扩展记录

### MCP 远程传输与授权：Streamable HTTP + OAuth

这是阶段 14 完成后的优先候选记录，不属于 T1401–T1409 的范围，也不因记录在此自动成为下一
任务。正式领取前必须通过路线图变更控制新增阶段/任务，并重新核对届时的 MCP 正式规范。

候选范围至少包括：

- Streamable HTTP 的 POST JSON-RPC、可选 GET SSE 通道、响应 SSE、MCP Session ID、恢复、
  重连、并发请求、取消、断开、超时和代理行为。
- 远程端点的 HTTPS、Origin、DNS/重绑定、重定向、SSRF、证书、跨来源凭据发送和明确网络授权
  边界；远程 MCP 内容继续服从现有不可信输入与资源限额。
- MCP Authorization 规定的 OAuth 2.1、Protected Resource Metadata、Authorization Server
  Metadata、Client ID Metadata Documents/适用的客户端注册方式、Authorization Code + PKCE、
  精确 redirect URI、state/CSRF 防护、scope 和资源指示。
- Access/Refresh Token 只进入 Extension-owned SecretStorage；令牌生命周期、刷新、撤销、登出、
  账户/Server 绑定、错误分类和日志/持久化/Webview 排除必须有独立安全契约。
- 本地 stdio 与远程 Streamable HTTP 的统一 Server 身份、能力投影和 UX，以及不允许模型、
  工作区内容或 MCP Server 静默新增端点、改变授权范围或发起登录。

旧 HTTP+SSE 已是兼容路径，不作为新实现的默认传输。只有真实目标 Server 仍依赖它且收益足以
覆盖额外攻击面、测试矩阵和维护成本时，后续任务才可单独批准回退支持。WebSocket 或其他自定义
传输同样不在该候选的默认范围内。
