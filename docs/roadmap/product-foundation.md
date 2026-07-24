# CtrlZebra 产品与技术基础规格

本文档保存第一阶段的产品范围、技术基线、模块边界、核心接口草案、测试分层和完成定义。任务顺序与状态以 [实施计划索引](../implementation-plan.md) 为准。

## 1. 第一阶段产品范围

### 1.1 第一阶段必须实现

- VS Code Activity Bar 中的 Agent 侧边栏。
- 创建本地会话并发送用户消息。
- 使用一个模型供应商进行流式文本生成。
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
- MCP。
- 浏览器自动化。
- 图片生成或多模态文件解析。
- 自定义 Modes。
- Git 自动提交或自动创建 PR。
- 无审批的终端命令执行。
- Web 版 VS Code Extension。
- 云端账户、同步和遥测后端。
- SQLite、向量数据库或代码语义索引。

这些能力必须在基础 Agent Loop、审批、取消和会话恢复稳定后再评估。

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

约束：

- 严禁 `import "vscode"`。
- 严禁直接访问文件系统、终端、Webview 或 SecretStorage。
- 所有外部能力必须通过构造参数接口注入。

### 4.3 `packages/providers`

负责把第三方模型 SDK 转换为内部统一事件：

- 文本增量。
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

## 5. 依赖规则

```text
webview ───────────────→ protocol
extension ─────────────→ protocol + core + providers + builtin-tools
providers ─────────────→ core contracts
builtin-tools ─────────→ core contracts + protocol DTO
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

`ModelRequest` 只包含 Core 模型消息，不复用持久化 Chat Message DTO。Provider 失败通过带有稳定 `ModelGatewayErrorCode` 的 `ModelGatewayError` 抛出；取消保留调用方的取消原因，不转换为 Provider 失败。

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

要求：

- 不启动 VS Code。
- 不访问网络。
- 不依赖系统时间和随机 ID。
- 单个测试文件应在秒级内完成。

### 7.2 组件测试

适用模块：

- 消息列表。
- 流式消息。
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
