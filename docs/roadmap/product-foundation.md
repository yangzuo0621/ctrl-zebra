# CtrlZebra 产品与技术基础规格

本文档保存第一阶段的产品范围、技术基线、模块边界、核心接口草案、测试分层和完成定义，
并记录第一阶段完成后经过路线图批准的范围扩展。任务顺序与状态以
[实施计划索引](../implementation-plan.md) 为准。

## 1. 第一阶段产品范围

### 1.1 第一阶段必须实现

- VS Code Activity Bar 中的 Agent 侧边栏。
- 创建本地会话并发送用户消息。
- 使用一个模型供应商进行流式文本生成。
- 当 Provider 正式流事件实际返回用户可见推理摘要时，在对话中以独立、可选且有界的“推理摘要”
  展示；该内容不是模型原始、隐藏或完整思维链。
- 取消正在进行的模型请求。
- `list_files`、`read_file`、`search_files` 三个只读工具。
- 模型发起 Tool Call 后，插件执行工具并继续模型循环。
- 提出文本文件修改并显示 Diff。
- 用户批准后通过 `WorkspaceEdit` 应用修改。
- 会话消息和状态持久化。
- VS Code 重启后恢复已完成或中断的会话。
- API Key 使用 `SecretStorage` 保存。
- 基础日志、错误处理和 Token 使用量显示。

### 1.2 第一阶段明确不做

- 多 Agent 或子 Agent。
- 第一阶段内不实现 MCP；第一阶段完成后的阶段 14 授权范围见 1.3。
- 浏览器自动化。
- 图片生成或多模态文件解析。
- 通过提示词要求、额外模型调用或 Host 推断生成、补写或重建模型思维过程。
- 自定义 Modes。
- Git 自动提交或自动创建 PR。
- 无审批的终端命令执行。
- Web 版 VS Code Extension。
- 云端账户、同步和遥测后端。
- SQLite、向量数据库或代码语义索引。

这些能力必须在基础 Agent Loop、审批、取消和会话恢复稳定后再评估。

### 1.3 阶段 14 授权扩展：MCP Client

阶段 14 在已完成的基础 Agent Loop、审批、取消和会话恢复之上，引入受限的 MCP Client
能力。首期产品范围仅包括：

- 桌面 VS Code Extension 作为 MCP Host，为用户显式配置的首期单一服务器拥有一个独立
  MCP Client 连接。
- 以 MCP `2026-07-28` 规范作为设计与兼容性评审基线；首期只接受该精确协议版本，
  不自动降级到旧协议或接受未知未来版本。实现任务开始时仍须通过 Context7 核对当前官方
  SDK 和勘误，不以未固定的 `latest` 隐式改变协议行为。
- 仅支持由用户显式配置并连接的本地 `stdio` MCP Server，以及服务器声明的 MCP Tools、
  MCP Resources（含 Resource Templates）和 MCP Prompts 三类主要 Server 原语。
- 发现、分页列举、变更通知和调用 MCP Tools，并将其适配到现有 Core Tool Registry、Agent
  Loop、取消、结果限额、审批和展示边界；以应用/用户控制方式读取 Resources 并加入有界上下文，
  以用户主动选择方式获取 Prompts 并加入对话输入。
- 服务器进程和每次外部 Tool 调用均受 Extension-owned 生命周期、Workspace Trust、
  明确用户授权和安全清理约束；模型、工作区内容和 Webview 不能创建或扩大服务器配置。

阶段 14 不授权 Streamable HTTP、旧 HTTP+SSE 回退、远程服务器鉴权、OAuth、Sampling、
Elicitation、Roots、Tasks、`input_required` 自动履行或手工续轮、MCP Server 托管、服务器市场、
自动安装、工作区共享配置或多模态内容。SDK 或 Server 在 `2026-07-28` 下提供这些能力不代表
CtrlZebra 声明、注册或处理它们；
后续增加这些能力必须重新经过路线图和对应权威文档的变更控制。

阶段 14 的具体模块边界、配置格式、Tool 命名、风险归类、协议 DTO 和用户体验由 T1401
的独立 docs-only 约束门禁确定；本节只授权产品范围，不提前把尚未评审的实现草案变成公共
契约。

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

## 3. 目标项目结构

```text
vscode-agent/
├─ apps/
│  ├─ extension/
│  │  ├─ src/
│  │  │  ├─ extension.ts
│  │  │  ├─ container.ts
│  │  │  ├─ commands/
│  │  │  ├─ controllers/
│  │  │  ├─ views/
│  │  │  ├─ adapters/
│  │  │  └─ lifecycle/
│  │  ├─ package.json
│  │  └─ tsconfig.json
│  └─ webview/
│     ├─ src/
│     │  ├─ components/
│     │  ├─ features/
│     │  ├─ state/
│     │  ├─ vscode.ts
│     │  └─ main.tsx
│     ├─ index.html
│     ├─ package.json
│     └─ vite.config.ts
├─ packages/
│  ├─ protocol/
│  ├─ core/
│  ├─ providers/
│  ├─ builtin-tools/
│  ├─ mcp-client/
│  └─ testkit/
├─ scripts/
├─ package.json
├─ pnpm-workspace.yaml
├─ tsconfig.base.json
└─ biome.json
```

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

实际文件操作由 Extension 中的适配器完成。

### 4.5 `apps/extension`

负责 VS Code 集成：

- 注册命令和 `WebviewViewProvider`。
- 依赖装配。
- 将 Webview 命令转发给 SessionManager。
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

提供稳定的测试替身：

- `FakeModelGateway`
- `FakeTool`
- `InMemorySessionRepository`
- `FakeApprovalService`
- `CollectingEventSink`
- 固定时钟和固定 ID 生成器

测试中禁止依赖真实模型 API。

### 4.8 `packages/mcp-client`

负责隔离官方 MCP SDK 并提供 Host-independent 的受控 Client 边界：

- MCP `2026-07-28` 精确版本协商和三类获授权 Server 原语。
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

## 6. 核心接口草案

### 6.1 模型接口

```ts
export interface ModelGateway {
  stream(
    request: ModelRequest,
    signal: AbortSignal,
  ): AsyncIterable<ModelEvent>;
}

export type ModelEvent =
  | { type: "text.delta"; text: string }
  | { type: "reasoning.start"; blockId: string }
  | { type: "reasoning.delta"; blockId: string; text: string }
  | { type: "reasoning.end"; blockId: string }
  | { type: "tool.call"; call: ToolCall }
  | { type: "usage"; usage: TokenUsage }
  | { type: "finish"; reason: FinishReason };

export type ModelGatewayErrorCode =
  | "authentication"
  | "rate-limit"
  | "invalid-request"
  | "unavailable"
  | "malformed-response"
  | "unknown";
```

`ModelRequest` 只包含 Core 模型消息，不复用持久化 Chat Message DTO。Provider 失败通过带有稳定
`ModelGatewayErrorCode` 的 `ModelGatewayError` 抛出；取消保留调用方的取消原因，不转换为
Provider 失败。

Reasoning 事件是可选的 Provider-neutral 内容事件，只在底层 Provider 正式流实际产生用户可见
reasoning 文本时出现。`blockId` 是 CtrlZebra 自有的关联标识，不承载 Provider metadata；
reasoning 文本不进入 `ModelRequest`、Tool 输入、最终回答或后续模型上下文。精确生命周期、资源
上限、持久化和展示规则分别由 [Architecture](../architecture.md)、
[Protocol](../protocol.md)、[Persistence](../persistence.md)、[Security](../security.md)、
[UX](../ux.md) 和 [Webview](../webview.md) 共同约束。

### 6.2 工具接口

```ts
export interface AgentTool<Input = unknown, Output = unknown> {
  readonly name: string;
  readonly risk: "read" | "write" | "execute" | "network";
  parseInput(value: unknown): Input;
  execute(
    input: Input,
    context: ToolExecutionContext,
  ): Promise<Output>;
}
```

### 6.3 Agent 状态

```ts
export type AgentStatus =
  | "idle"
  | "preparing"
  | "streaming"
  | "awaiting_approval"
  | "executing_tool"
  | "completed"
  | "cancelled"
  | "failed";
```

### 6.4 会话仓库

```ts
export interface SessionRepository {
  create(session: SessionRecord): Promise<void>;
  get(sessionId: string): Promise<SessionRecord | undefined>;
  list(): Promise<SessionSummary[]>;
  appendEvent(sessionId: string, event: PersistedEvent): Promise<void>;
  updateMetadata(sessionId: string, patch: SessionMetadataPatch): Promise<void>;
}
```

### 6.5 审批接口

```ts
export interface ApprovalService {
  request(
    request: ApprovalRequest,
    signal: AbortSignal,
  ): Promise<ApprovalDecision>;
}
```

## 7. 测试分层

### 7.1 纯单元测试

适用模块：

- Protocol Schema。
- Agent Loop。
- Tool Registry。
- Approval Policy。
- Context Budget。
- Session 状态转换。
- Provider 事件标准化。
- 推理摘要 start/delta/end 生命周期、交错顺序、资源边界和取消。

要求：

- 不启动 VS Code。
- 不访问网络。
- 不依赖系统时间和随机 ID。
- 单个测试文件应在秒级内完成。

### 7.2 组件测试

适用模块：

- 消息列表。
- 流式消息。
- 推理摘要的折叠、截断、部分恢复和无内容降级。
- Tool 卡片。
- 审批按钮。
- 错误和取消状态。

使用 Testing Library，从用户行为而非组件内部实现进行断言。

### 7.3 Extension 集成测试

只验证 VS Code API 适配器：

- 命令成功注册。
- Webview View 可以解析。
- Workspace 文件可读。
- `WorkspaceEdit` 可以应用。
- 存储目录可以创建和恢复。
- SecretStorage 适配器行为正确。

### 7.4 人工烟雾测试

每个阶段结束时执行，不替代自动化测试：

1. 在 Extension Development Host 中打开测试工作区。
2. 打开 Agent 侧边栏。
3. 执行该阶段定义的完整用户路径。
4. 检查 Developer Tools 和 Output Channel 没有未处理错误。

## 8. 完成定义

每个任务只有同时满足以下条件才算完成：

- 代码通过 TypeScript 类型检查。
- 新逻辑拥有对应自动化测试。
- 全部已有测试通过。
- lint 和格式检查通过。
- 没有在任务范围之外增加功能。
- 当前任务声明的约束门禁已在实现前完成并合入主干。
- 必要的公共接口和设计决策已更新到本文档。
- 如果涉及 UI 或 VS Code API，人工烟雾测试通过。
