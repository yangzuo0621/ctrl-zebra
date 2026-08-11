# CtrlZebra 产品与技术基础规格

本文档只保存当前获准的产品范围、技术基线、模块边界、跨模块契约地图、产品级验证要求和完成
定义。任务顺序、实施状态和完成证据以[实施计划索引](../implementation-plan.md)为准；具体运行时、
安全、协议、持久化、Webview 和体验语义由对应领域文档拥有；历史授权过程保留在阶段归档和 ADR，
不在这里重复维护。

## 1. 当前授权产品范围

本节同时包含已经实现和尚待路线图任务交付的获准能力。它只决定产品边界，不代表实施状态，也不
提前批准 DTO、Tool 名称、持久化字段、状态转换、错误码、算法、依赖或安全实现。

### 1.1 获准能力

- 产品形态保持为桌面 VS Code Extension，通过 Activity Bar Agent 侧边栏提供本地优先的对话和
  工作区协作体验；不引入云账户、同步或遥测后端。
- 用户可以创建、恢复和显式续接本地多轮 Session；历史重建、上下文裁剪、Token Usage、截断和
  溢出恢复保持取消、审批、持久化兼容和资源上限。后续获准重新生成、编辑重发、工作区文件引用、
  会话删除、历史清空、保留策略及全部 CtrlZebra-owned 本地数据清除。
- OpenAI、Gemini 和 OpenAI-compatible 三个 Provider 通过统一的 Provider-neutral Runtime 提供
  流式文本、Tool Calling、可选且有界的用户可见推理摘要、受控重试、稳定错误和 Token Usage。
  用户可以保存、删除、轮换凭据，选择或手工配置模型，并主动执行不携带工作区或会话内容的最小
  连接与能力检查；无法可靠判断的能力显示为未知。凭据只由 Extension-owned `SecretStorage` 保存。
- 内置工作区能力包括有界文件列举、读取、搜索、正则搜索、文本修改提议、命令执行，以及后续获准
  的创建、删除、重命名和多文件原子编辑。任何副作用继续服从 Workspace Trust、规范路径、精确
  一次性审批、可审阅 Diff、`WorkspaceEdit` 或等价原子写入、取消、结果限额和可恢复 Checkpoint。
  Model 发起的 Tool Call 经受控执行产生 Tool Result 后，才可继续 Agent Loop。
- Webview 提供流式消息、Tool 和审批状态、Session 恢复、Token Usage、可访问交互、一致产品语言
  和受限技术 Markdown。内容呈现不得扩大 CSP、命令、文件、网络、HTML 或未批准 URI 能力。
- Extension 可以在用户控制和工作区范围内读取活动编辑器、选区、诊断及 VS Code 语言服务结果，
  作为有界、不可信、可关闭的上下文或只读 Tool Result；不建立自有语义、向量或代码索引。
- 一个用户显式配置并连接的本地 stdio MCP Server 可以提供 Tools、Resources（含 Templates）和
  Prompts。MCP Tool 进入现有 Core Tool、审批、取消和结果边界；Resource 与 Prompt 只通过用户或
  应用控制的有界路径进入普通不可信上下文。阶段 18 获准显式 `modern-only | dual` 模式，闭集支持
  modern `2026-07-28` 与 legacy `2025-11-25`，并遵循
  [ADR 0002](../adr/0002-mcp-dual-era-stdio-compatibility.md)；现有配置不静默启用 dual。Server 进程、
  配置、Workspace Trust、启动批准和完整进程树清理继续由 Extension 拥有；Model、Webview 和
  工作区内容不能创建或扩大 Server 配置。
- Preview/GA 工程范围包括覆盖率与跨平台 CI、仓库治理、受审查依赖更新、数据迁移或只读降级、
  单次 Run 成本护栏、用户主动脱敏诊断导出、性能与资源预算、许可证/SBOM/VSIX 内容审计、可重复
  发布流水线和 Marketplace 证据。实际发布仍需单独明确授权。

### 1.2 明确排除

- 多 Agent、子 Agent、Skills、跨会话记忆、自定义 Modes、运行中插话和多模态输入或文件解析。
- 浏览器自动化、自动 Git 提交或 PR、自动发布，以及无精确审批的命令或工作区副作用。
- Web Extension、云端账户、同步、遥测后端、SQLite、向量数据库、自建语义或代码索引。
- 通过提示词、额外模型调用或 Host 推断生成、补写或重建模型隐藏或完整思维过程。
- 旧于 MCP `2025-11-25` 或未知未来版本、Streamable HTTP、旧 HTTP+SSE、远程 MCP、OAuth、多
  Server、自动安装、服务器市场、工作区共享 Server 配置，以及 Roots、Sampling、Elicitation、
  Tasks、`input_required` 续轮或未获准 Server-to-Client 能力。

外部 SDK、评估报告或候选清单出现某项能力不构成授权。扩大本节范围必须先更新本文档和路线图；
涉及信任模型或长期架构时还需更新对应领域文档和 ADR。

### 1.3 范围演进记录

- 阶段 0–13 的基础 Extension、Agent Loop、工作区工具、审批、持久化、Provider 与推理摘要范围见
  实施计划中的[阶段规格索引](../implementation-plan.md#5-阶段规格索引)。
- 阶段 14 的受控 MCP Client 授权与完成规格见[阶段 14 归档](archive/phase-14.md)和
  [ADR 0001](../adr/0001-controlled-mcp-client-boundary.md)。
- 阶段 15 的多轮对话与上下文生命周期见[阶段 15 归档](archive/phase-15.md)。
- 阶段 16–22 的获准产品闭环和发布范围见实施计划中的[阶段规格索引](../implementation-plan.md#5-阶段规格索引)；
  任务状态仍只由实施计划拥有。

## 2. 技术基线

| 领域 | 选型 |
|---|---|
| 语言 | TypeScript，开启 `strict` |
| 包管理 | pnpm workspace |
| Extension 构建 | esbuild |
| Webview | React + Vite |
| Webview 状态 | Zustand |
| 样式 | CSS Modules + VS Code CSS Variables |
| 运行时校验 | Zod |
| MCP Client | 官方 `@modelcontextprotocol/client` v2；首个实现精确固定 `2.0.0`，隔离在 `packages/mcp-client` |
| 外部 Tool JSON Schema | 同一固定 SDK 的公开 Ajv validator，经闭合集关键字与结构限额后编译 |
| 模型标准化层 | Vercel AI SDK 7，外包一层自有接口 |
| 单元测试 | Vitest |
| UI 测试 | Testing Library + jsdom |
| Extension 集成测试 | `@vscode/test-electron` |
| 格式化和静态检查 | Biome + TypeScript |
| 发布 | `@vscode/vsce` |

版本安装时选择相互兼容的稳定版本并提交 lockfile，不使用未固定的 `latest` 作为长期依赖声明。

## 3. Workspace 结构

```text
ctrl-zebra/
├─ apps/
│  ├─ extension/        # VS Code Host、组合根、适配器和控制器
│  └─ webview/          # React 展示和用户交互
├─ packages/
│  ├─ protocol/         # 跨边界 DTO 与 Schema
│  ├─ core/             # Host-、Provider-neutral 业务逻辑
│  ├─ providers/        # 具体模型 SDK 适配器
│  ├─ builtin-tools/    # Host-independent 内置 Tool
│  ├─ mcp-client/       # 受控 MCP SDK 边界
│  └─ testkit/          # 跨包测试替身
└─ docs/                # 路线图、领域规范、ADR 和发布文档
```

本节只固定 Workspace 级模块，不规定包内文件夹或具体文件。实际源码树和各包公共 `exports` 是
实现结构的事实来源；新增或移动 Workspace 模块仍需先更新本节和依赖规则。

## 4. 模块边界

### 4.1 `packages/protocol`

负责所有跨边界的数据结构：

- Webview 到 Extension 的命令。
- Extension 到 Webview 的事件。
- Session、Message、Tool Call 的可序列化 DTO。
- 推理摘要块、流事件、截断状态和恢复投影的严格可序列化 DTO。
- Zod Schema 和由 Schema 推导的 TypeScript 类型。
- 持久化格式版本号。

约束：

- 不能依赖 React、VS Code 或模型 SDK。
- 所有数据必须可以 JSON 序列化。
- Webview 输入在 Extension Host 中必须经过运行时校验。

### 4.2 `packages/core`

负责与宿主无关的业务逻辑：

- Agent 状态机和循环。
- Session 生命周期。
- Tool Registry 和 Tool Executor。
- Approval Policy。
- Context 构造、裁剪和摘要接口。
- Checkpoint 数据模型。
- 领域事件和错误分类。
- Provider-neutral 推理摘要生命周期以及与正文、Tool 和终态保持源顺序的转发。

约束：

- 严禁 `import "vscode"`。
- 严禁直接访问文件系统、终端、Webview 或 SecretStorage。
- 所有外部能力必须通过构造参数接口注入。

### 4.3 `packages/providers`

负责把第三方模型 SDK 转换为内部统一事件：

- 文本增量。
- Provider 正式返回的用户可见推理摘要增量。
- Tool Call。
- Finish Reason。
- Token Usage。
- Provider Error。

对外只实现 `ModelGateway`；Agent Core 不直接依赖 Vercel AI SDK 类型。

### 4.4 `packages/builtin-tools`

负责内置工具定义和宿主无关的参数校验：

- `list_files`
- `read_file`
- `search_files`
- `propose_file_edit`
- `run_command`

实际文件操作由 Extension 中的适配器完成。

### 4.5 `apps/extension`

负责 VS Code 集成：

- 注册命令和 `WebviewViewProvider`。
- 依赖装配。
- 验证并将 Webview 命令分派给拥有相应生命周期的控制器。
- 实现文件、编辑器、Diff、存储、日志和密钥适配器。
- 管理 Disposable 和扩展生命周期。

`extension.ts` 只允许做注册和装配，不放业务流程。

### 4.6 `apps/webview`

负责纯展示和用户交互：

- 聊天消息列表。
- 流式文本渲染。
- 独立、可折叠的推理摘要展示。
- Tool Call 状态卡片。
- 审批界面。
- 会话选择和设置。

约束：

- 不持有 API Key。
- 不直接调用模型、文件系统或 VS Code 命令。
- 服务端事实状态以 Extension 发来的 snapshot/event 为准。

### 4.7 `packages/testkit`

提供跨包复用的稳定 Core contract 测试替身，例如确定性 Model Gateway、Summarizer 和事件收集器。
具体替身名称及公共范围以该包 `exports` 为准；仅由单个包使用的 Fake 保留在该包测试中。测试中
禁止依赖真实模型 API、用户凭据或机器状态。

### 4.8 `packages/mcp-client`

负责隔离官方 MCP SDK 并提供 Host-independent 的受控 Client 边界：

- MCP modern `2026-07-28` 与 legacy `2025-11-25` 的受控 stdio 协商，以及两个纪元共有的三类
  获授权 Server 原语；阶段 18 完成前生产实现仍保持 modern-only。
- 请求关联、取消、分页、列表变更刷新、限额和稳定错误归一化。
- 通过注入的 stdio/process port 管理协议生命周期，不直接创建真实进程。
- 将 MCP Tool 适配为现有 Core Tool contracts，但不拥有 Registry、审批或 Agent Loop。

约束：

- 官方 MCP SDK、JSON-RPC、transport、capability、schema 和 error 类型不得越过包的公共入口。
- 不依赖 VS Code、Extension adapters、React、Webview 或 persistence。
- 不声明或处理 Roots、Sampling、Elicitation、Tasks、`input_required` 续轮、HTTP、OAuth、实验
  或多模态能力。
- 真实配置、Workspace Trust、spawn、最小环境和完整进程树清理仍由 `apps/extension` 拥有。

## 5. 依赖规则

```text
webview ───────────────→ protocol
extension ─────────────→ protocol + core + providers + builtin-tools
extension ─────────────→ mcp-client
providers ─────────────→ core contracts
builtin-tools ─────────→ core contracts + protocol DTO
mcp-client ────────────→ core contracts (仅外部 Tool 适配)
core ──────────────────→ protocol
testkit ───────────────→ core contracts + protocol
```

禁止：

```text
core → vscode
core → webview
webview → core implementation
providers → extension
builtin-tools → vscode
core → mcp-client
mcp-client → vscode
mcp-client → extension
```

依赖规则应通过 lint 规则、路径约定或专门的架构测试保护。

## 6. 跨模块契约地图

本节只定位契约所有者并保存跨模块稳定约束，不复制 TypeScript 签名、枚举成员或 Schema。精确公共
接口以声明它的包公共入口为准；跨边界语义以对应领域文档为准。实现细节不得因为出现在代码中自动
成为新的产品或公共契约。

| 契约 | 代码事实来源 | 语义所有者 |
|---|---|---|
| Model 请求、事件、Usage、Finish 与稳定错误 | [`packages/core/src/model-gateway.ts`](../../packages/core/src/model-gateway.ts) | [Architecture：Model Provider Boundary](../architecture.md#model-provider-boundary) |
| Agent Loop、Tool 生命周期和 Session 转换 | [`packages/core`](../../packages/core/src/index.ts) 与 [`packages/protocol/src/session.ts`](../../packages/protocol/src/session.ts) | [Architecture：Tool Contract、Context 与 Session](../architecture.md#tool-contract-boundary) |
| Tool Call、Result、风险和 JSON 值 | [`packages/protocol/src/tool.ts`](../../packages/protocol/src/tool.ts) | [Protocol：Tool Data Contracts](../protocol.md#tool-data-contracts) 与 [Security：Tool Input and Output](../security.md#tool-input-and-output) |
| Webview/Extension 消息和请求关联 | [`packages/protocol/src/messages.ts`](../../packages/protocol/src/messages.ts) | [Protocol Guidelines](../protocol.md) |
| Session Repository、事件和恢复投影 | [`packages/core/src/session-repository.ts`](../../packages/core/src/session-repository.ts) 与 [`packages/protocol/src/persistence.ts`](../../packages/protocol/src/persistence.ts) | [Persistence Contract](../persistence.md) |
| Approval 请求、决定、消费和失效 | [`packages/core`](../../packages/core/src/index.ts) 与 [`packages/protocol/src/approval.ts`](../../packages/protocol/src/approval.ts) | [Security：Approval Boundary](../security.md#approval-boundary) |
| MCP Client、Tool、Resource 与 Prompt 投影 | [`packages/mcp-client`](../../packages/mcp-client/src/index.ts) 与 [`packages/protocol`](../../packages/protocol/src/index.ts) | Architecture、Security、Protocol、Persistence、Webview 和 UX 中各自拥有的 MCP 章节 |

跨模块契约共同遵守以下不变量：

- 外部或跨进程输入以 `unknown` 进入拥有该边界的模块，验证后才能成为领域值。
- 取消是独立结果；取消后不得继续增量、Tool、重试、持久化副作用或用户不可见后台工作。
- VS Code、Node Host 和具体 SDK 类型不越过声明的适配器或包公共入口。
- Session 状态只经 Core 状态机改变；Tool、Provider、Webview 和持久化适配器不自行推进 Agent Loop。
- Secret、授权材料、原始第三方错误和不可信无限内容不得进入 Webview、持久化、日志或测试 fixture。
- 修改公共契约时先更新拥有其语义的领域文档；只有产品范围、技术基线或模块边界变化时才修改本
  文档。

## 7. 产品级验证要求

[Testing Guidelines](../testing.md) 拥有测试层级、命名、Fake/Mock、确定性、回归和异步清理规则。
本节只规定产品完成所需的证据类别，具体任务仍使用其阶段规格中的测试计划。

| 证据 | 最低目的 |
|---|---|
| 包级单元测试 | 证明 Core、Protocol、Provider、Tool、MCP 和纯策略的正常路径、重要边界及预期失败 |
| Webview 组件测试 | 从用户可见行为证明消息、流式状态、审批、恢复、可访问性和内容边界 |
| Extension 集成测试 | 证明 VS Code 注册、适配器、生命周期、存储、SecretStorage、进程和 Trust 边界 |
| VSIX smoke 与人工路径 | 证明打包产物可安装、激活并完成当前阶段声明的关键用户路径；不替代适用自动化测试 |
| CI、覆盖率与资源门禁 | 防止受支持平台、关键行为、性能预算和发布产物发生未审查回退 |

测试不访问真实模型、用户凭据或未受控网络，不依赖墙钟、随机值、执行顺序或用户机器状态。每个
阶段门禁可以提高证据要求，但不能降低本节和 Testing Guidelines 的共同基线。

## 8. 完成定义

任务只有同时满足以下条件才可按路线图流程标记完成：

- 当前任务的目标、产物、排除项、测试和阶段门禁全部满足，且没有夹带其他任务或能力。
- 必需的约束 PR 已先合入；公共契约、配置、持久化、安全或用户体验变化已更新其事实所有者。
- 新逻辑具有风险相称的自动化测试，既有测试、类型检查、Biome 和适用的集成或 smoke 验证通过。
- 取消、失败、资源清理、安全边界和数据兼容性保留可验证证据。
- 最终差异通过检查并经 PR 审查、squash merge 合入 `main`；未合入的分支或 PR 不算完成。
