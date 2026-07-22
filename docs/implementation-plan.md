# CtrlZebra — VS Code Agent 插件实施规格

> 状态：Draft 2
> 日期：2026-07-14
> 用途：作为项目从零实现、测试和验收的单一执行路线图。

## 1. 文档目标

本项目要实现名为 **CtrlZebra** 的桌面版 VS Code Agent 插件。插件可以接收用户任务，调用大模型，读取工作区文件，提出文件修改，等待用户审批，应用修改，并保存可恢复的会话。

本文档强调两个原则：

1. **任务最小化**：每个任务只引入一个主要概念，通常应能在一次小型提交中完成。
2. **可测试化**：业务逻辑优先放入不依赖 VS Code 的纯 TypeScript 模块；每个任务必须带自动化测试或明确的人工烟雾测试。

本文档同时是后续实现的任务清单。除非出现新的产品需求或技术阻塞，否则按任务编号顺序推进。

## 2. 第一阶段产品范围

### 2.1 第一阶段必须实现

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

### 2.2 第一阶段明确不做

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

## 3. 技术基线

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

## 4. 目标项目结构

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

## 5. 模块边界

### 5.1 `packages/protocol`

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

### 5.2 `packages/core`

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

### 5.3 `packages/providers`

负责把第三方模型 SDK 转换为内部统一事件：

- 文本增量。
- Tool Call。
- Finish Reason。
- Token Usage。
- Provider Error。

对外只实现 `ModelGateway`；Agent Core 不直接依赖 Vercel AI SDK 类型。

### 5.4 `packages/builtin-tools`

负责内置工具定义和宿主无关的参数校验：

- `list_files`
- `read_file`
- `search_files`
- `propose_file_edit`

实际文件操作由 Extension 中的适配器完成。

### 5.5 `apps/extension`

负责 VS Code 集成：

- 注册命令和 `WebviewViewProvider`。
- 依赖装配。
- 将 Webview 命令转发给 SessionManager。
- 实现文件、编辑器、Diff、存储、日志和密钥适配器。
- 管理 Disposable 和扩展生命周期。

`extension.ts` 只允许做注册和装配，不放业务流程。

### 5.6 `apps/webview`

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

### 5.7 `packages/testkit`

提供稳定的测试替身：

- `FakeModelGateway`
- `FakeTool`
- `InMemorySessionRepository`
- `FakeApprovalService`
- `CollectingEventSink`
- 固定时钟和固定 ID 生成器

测试中禁止依赖真实模型 API。

## 6. 依赖规则

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

## 7. 核心接口草案

### 7.1 模型接口

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

### 7.2 工具接口

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

### 7.3 Agent 状态

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

### 7.4 会话仓库

```ts
export interface SessionRepository {
  create(session: SessionRecord): Promise<void>;
  get(sessionId: string): Promise<SessionRecord | undefined>;
  list(): Promise<SessionSummary[]>;
  appendEvent(sessionId: string, event: PersistedEvent): Promise<void>;
  updateMetadata(sessionId: string, patch: SessionMetadataPatch): Promise<void>;
}
```

### 7.5 审批接口

```ts
export interface ApprovalService {
  request(
    request: ApprovalRequest,
    signal: AbortSignal,
  ): Promise<ApprovalDecision>;
}
```

## 8. 测试分层

### 8.1 纯单元测试

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

### 8.2 组件测试

适用模块：

- 消息列表。
- 流式消息。
- Tool 卡片。
- 审批按钮。
- 错误和取消状态。

使用 Testing Library，从用户行为而非组件内部实现进行断言。

### 8.3 Extension 集成测试

只验证 VS Code API 适配器：

- 命令成功注册。
- Webview View 可以解析。
- Workspace 文件可读。
- `WorkspaceEdit` 可以应用。
- 存储目录可以创建和恢复。
- SecretStorage 适配器行为正确。

### 8.4 人工烟雾测试

每个阶段结束时执行，不替代自动化测试：

1. 在 Extension Development Host 中打开测试工作区。
2. 打开 Agent 侧边栏。
3. 执行该阶段定义的完整用户路径。
4. 检查 Developer Tools 和 Output Channel 没有未处理错误。

## 9. 完成定义

每个任务只有同时满足以下条件才算完成：

- 代码通过 TypeScript 类型检查。
- 新逻辑拥有对应自动化测试。
- 全部已有测试通过。
- lint 和格式检查通过。
- 没有在任务范围之外增加功能。
- 当前任务声明的约束门禁已在实现前完成并合入主干。
- 必要的公共接口和设计决策已更新到本文档。
- 如果涉及 UI 或 VS Code API，人工烟雾测试通过。

## 10. 实施阶段与最小任务

任务编号是稳定标识。后续实现时一次只领取一个任务，完成验证后再进入下一个。

部分任务包含“开始前约束门禁”。门禁只规定必须在何时建立哪些规则以及规则的最低覆盖范围，不在本文档中提前固化容易过时的实现细节。执行方式如下：

1. 开始实现前检查门禁指定的规范或配置是否已经存在且仍然适用。
2. 如果缺失或不足，先使用当前任务编号创建独立约束 PR：通常是 docs-only；机械规则需要自动执行时可以是 config-only。
3. 独立约束 PR 通过审查并 squash 合入 `main` 后，再从最新 `main` 创建实现分支。
4. 门禁 PR 不代表任务完成；只有实现、测试和任务验收全部通过后，才能标记该任务完成。

### 任务状态管理

本节是全部任务状态的唯一台账。任务正文不重复维护状态，避免同一任务出现两个不同结论。

状态只允许使用以下四个值：

- `待开始`：任务尚未领取，或主干中还没有该任务的完成记录。
- `进行中`：已经从最新 `main` 创建任务分支，正在完成约束门禁、实现或验证。
- `受阻`：任务已经开始，但存在有证据的外部阻塞或需要先批准的设计变更。
- `已完成`：完成定义全部满足，任务 PR 已通过 squash merge 合入 `main`。

状态更新规则：

1. 默认转换为 `待开始 → 进行中 → 已完成`；出现真实阻塞时可以在 `进行中` 与 `受阻` 之间转换。
2. 同一时间最多有一个 `进行中` 任务；约束门禁和实现共享同一个任务状态。
3. 创建任务分支后，先在该分支把任务标记为 `进行中`。主干保存最后一个已合入基线，活动状态以当前任务分支或其 PR 中的本表为准。
4. 任务通过全部验证后，在最终 PR 中将状态改为 `已完成`，填写完成 PR 和完成日期；PR 未合入前，主干中的任务仍不算完成。
5. 约束 PR 不能把任务标记为 `已完成`。如果任务长期受阻且工作分支不会合入，应通过独立状态 PR 将 `受阻` 状态同步到主干。
6. `已完成` 任务只有在发现验收记录错误或实施规格被正式修订时才能重新打开，并必须说明原因。
7. 每次状态变化同时更新下方进度摘要；完成证据使用 GitHub PR 编号或链接，不记录无法在 squash 前确定的最终 commit SHA。

**进度摘要**：

- 总任务：73
- 已完成：70
- 进行中：0
- 受阻：0
- 待开始：3
- 当前任务：无
- 下一任务：T1003
- 最后更新：2026-07-22

| 阶段 | 任务 | 状态 | 完成 PR | 完成日期 |
|---|---|---|---|---|
| 0 | T0001 | 已完成 | [#4](https://github.com/yangzuo0621/ctrl-zebra/pull/4) | 2026-07-14 |
| 0 | T0002 | 已完成 | [#6](https://github.com/yangzuo0621/ctrl-zebra/pull/6) | 2026-07-14 |
| 0 | T0003 | 已完成 | [#7](https://github.com/yangzuo0621/ctrl-zebra/pull/7) | 2026-07-14 |
| 0 | T0004 | 已完成 | [#9](https://github.com/yangzuo0621/ctrl-zebra/pull/9) | 2026-07-14 |
| 1 | T0101 | 已完成 | [#11](https://github.com/yangzuo0621/ctrl-zebra/pull/11) | 2026-07-14 |
| 1 | T0102 | 已完成 | [#12](https://github.com/yangzuo0621/ctrl-zebra/pull/12) | 2026-07-15 |
| 1 | T0103 | 已完成 | [#13](https://github.com/yangzuo0621/ctrl-zebra/pull/13) | 2026-07-15 |
| 1 | T0104 | 已完成 | [#14](https://github.com/yangzuo0621/ctrl-zebra/pull/14) | 2026-07-15 |
| 1 | T0105 | 已完成 | [#15](https://github.com/yangzuo0621/ctrl-zebra/pull/15) | 2026-07-15 |
| 2 | T0201 | 已完成 | [#16](https://github.com/yangzuo0621/ctrl-zebra/pull/16) | 2026-07-15 |
| 2 | T0202 | 已完成 | [#17](https://github.com/yangzuo0621/ctrl-zebra/pull/17) | 2026-07-15 |
| 2 | T0203 | 已完成 | [#18](https://github.com/yangzuo0621/ctrl-zebra/pull/18) | 2026-07-15 |
| 2 | T0204 | 已完成 | [#19](https://github.com/yangzuo0621/ctrl-zebra/pull/19) | 2026-07-15 |
| 2 | T0205 | 已完成 | [#20](https://github.com/yangzuo0621/ctrl-zebra/pull/20) | 2026-07-15 |
| 3 | T0301 | 已完成 | [#22](https://github.com/yangzuo0621/ctrl-zebra/pull/22) | 2026-07-15 |
| 3 | T0302 | 已完成 | [#23](https://github.com/yangzuo0621/ctrl-zebra/pull/23) | 2026-07-16 |
| 3 | T0303 | 已完成 | [#24](https://github.com/yangzuo0621/ctrl-zebra/pull/24) | 2026-07-16 |
| 3 | T0304 | 已完成 | [#25](https://github.com/yangzuo0621/ctrl-zebra/pull/25) | 2026-07-16 |
| 3 | T0305 | 已完成 | [#26](https://github.com/yangzuo0621/ctrl-zebra/pull/26) | 2026-07-16 |
| 3 | T0306 | 已完成 | [#28](https://github.com/yangzuo0621/ctrl-zebra/pull/28) | 2026-07-16 |
| 3 | T0307 | 已完成 | [#30](https://github.com/yangzuo0621/ctrl-zebra/pull/30) | 2026-07-17 |
| 3 | T0308 | 已完成 | [#31](https://github.com/yangzuo0621/ctrl-zebra/pull/31) | 2026-07-17 |
| 3 | T0309 | 已完成 | [#32](https://github.com/yangzuo0621/ctrl-zebra/pull/32) | 2026-07-17 |
| 3 | T0310 | 已完成 | [#35](https://github.com/yangzuo0621/ctrl-zebra/pull/35) | 2026-07-17 |
| 4 | T0401 | 已完成 | [#39](https://github.com/yangzuo0621/ctrl-zebra/pull/39) | 2026-07-17 |
| 4 | T0402 | 已完成 | [#40](https://github.com/yangzuo0621/ctrl-zebra/pull/40) | 2026-07-17 |
| 4 | T0403 | 已完成 | [#41](https://github.com/yangzuo0621/ctrl-zebra/pull/41) | 2026-07-17 |
| 4 | T0404 | 已完成 | [#42](https://github.com/yangzuo0621/ctrl-zebra/pull/42) | 2026-07-17 |
| 4 | T0405 | 已完成 | [#43](https://github.com/yangzuo0621/ctrl-zebra/pull/43) | 2026-07-17 |
| 4 | T0406 | 已完成 | [#44](https://github.com/yangzuo0621/ctrl-zebra/pull/44) | 2026-07-17 |
| 4 | T0407 | 已完成 | [#45](https://github.com/yangzuo0621/ctrl-zebra/pull/45) | 2026-07-17 |
| 4 | T0408 | 已完成 | [#46](https://github.com/yangzuo0621/ctrl-zebra/pull/46) | 2026-07-17 |
| 4 | T0409 | 已完成 | [#47](https://github.com/yangzuo0621/ctrl-zebra/pull/47) | 2026-07-17 |
| 4 | T0410 | 已完成 | [#48](https://github.com/yangzuo0621/ctrl-zebra/pull/48) | 2026-07-17 |
| 4 | T0411 | 已完成 | [#50](https://github.com/yangzuo0621/ctrl-zebra/pull/50) | 2026-07-18 |
| 5 | T0501 | 已完成 | [#53](https://github.com/yangzuo0621/ctrl-zebra/pull/53) | 2026-07-19 |
| 5 | T0502 | 已完成 | [#54](https://github.com/yangzuo0621/ctrl-zebra/pull/54) | 2026-07-19 |
| 5 | T0503 | 已完成 | [#55](https://github.com/yangzuo0621/ctrl-zebra/pull/55) | 2026-07-19 |
| 5 | T0504 | 已完成 | [#56](https://github.com/yangzuo0621/ctrl-zebra/pull/56) | 2026-07-19 |
| 5 | T0505 | 已完成 | [#57](https://github.com/yangzuo0621/ctrl-zebra/pull/57) | 2026-07-19 |
| 5 | T0506 | 已完成 | [#58](https://github.com/yangzuo0621/ctrl-zebra/pull/58) | 2026-07-19 |
| 5 | T0507 | 已完成 | [#59](https://github.com/yangzuo0621/ctrl-zebra/pull/59) | 2026-07-19 |
| 5 | T0508 | 已完成 | [#60](https://github.com/yangzuo0621/ctrl-zebra/pull/60) | 2026-07-19 |
| 5 | T0509 | 已完成 | [#61](https://github.com/yangzuo0621/ctrl-zebra/pull/61) | 2026-07-19 |
| 6 | T0601 | 已完成 | [#63](https://github.com/yangzuo0621/ctrl-zebra/pull/63) | 2026-07-19 |
| 6 | T0602 | 已完成 | [#64](https://github.com/yangzuo0621/ctrl-zebra/pull/64) | 2026-07-19 |
| 6 | T0603 | 已完成 | [#65](https://github.com/yangzuo0621/ctrl-zebra/pull/65) | 2026-07-19 |
| 6 | T0604 | 已完成 | [#66](https://github.com/yangzuo0621/ctrl-zebra/pull/66) | 2026-07-19 |
| 6 | T0605 | 已完成 | [#67](https://github.com/yangzuo0621/ctrl-zebra/pull/67) | 2026-07-19 |
| 6 | T0606 | 已完成 | [#68](https://github.com/yangzuo0621/ctrl-zebra/pull/68) | 2026-07-19 |
| 6 | T0607 | 已完成 | [#69](https://github.com/yangzuo0621/ctrl-zebra/pull/69) | 2026-07-19 |
| 7 | T0701 | 已完成 | [#71](https://github.com/yangzuo0621/ctrl-zebra/pull/71) | 2026-07-19 |
| 7 | T0702 | 已完成 | [#72](https://github.com/yangzuo0621/ctrl-zebra/pull/72) | 2026-07-19 |
| 7 | T0703 | 已完成 | [#73](https://github.com/yangzuo0621/ctrl-zebra/pull/73) | 2026-07-19 |
| 7 | T0704 | 已完成 | [#74](https://github.com/yangzuo0621/ctrl-zebra/pull/74) | 2026-07-19 |
| 7 | T0705 | 已完成 | [#75](https://github.com/yangzuo0621/ctrl-zebra/pull/75) | 2026-07-19 |
| 7 | T0706 | 已完成 | [#76](https://github.com/yangzuo0621/ctrl-zebra/pull/76) | 2026-07-19 |
| 7 | T0707 | 已完成 | [#77](https://github.com/yangzuo0621/ctrl-zebra/pull/77) | 2026-07-19 |
| 8 | T0801 | 已完成 | [#79](https://github.com/yangzuo0621/ctrl-zebra/pull/79) | 2026-07-19 |
| 8 | T0802 | 已完成 | [#80](https://github.com/yangzuo0621/ctrl-zebra/pull/80) | 2026-07-19 |
| 8 | T0803 | 已完成 | [#81](https://github.com/yangzuo0621/ctrl-zebra/pull/81) | 2026-07-19 |
| 8 | T0804 | 已完成 | [#82](https://github.com/yangzuo0621/ctrl-zebra/pull/82) | 2026-07-19 |
| 9 | T0901 | 已完成 | [#84](https://github.com/yangzuo0621/ctrl-zebra/pull/84) | 2026-07-19 |
| 9 | T0902 | 已完成 | [#85](https://github.com/yangzuo0621/ctrl-zebra/pull/85) | 2026-07-19 |
| 9 | T0903 | 已完成 | [#86](https://github.com/yangzuo0621/ctrl-zebra/pull/86) | 2026-07-19 |
| 9 | T0904 | 已完成 | [#87](https://github.com/yangzuo0621/ctrl-zebra/pull/87) | 2026-07-19 |
| 9 | T0905 | 已完成 | [#88](https://github.com/yangzuo0621/ctrl-zebra/pull/88) | 2026-07-22 |
| 9 | T0906 | 已完成 | [#89](https://github.com/yangzuo0621/ctrl-zebra/pull/89) | 2026-07-22 |
| 10 | T1001 | 已完成 | [#91](https://github.com/yangzuo0621/ctrl-zebra/pull/91) | 2026-07-22 |
| 10 | T1002 | 已完成 | [#92](https://github.com/yangzuo0621/ctrl-zebra/pull/92) | 2026-07-22 |
| 10 | T1003 | 待开始 | — | — |
| 10 | T1004 | 待开始 | — | — |
| 10 | T1005 | 待开始 | — | — |

---

## 阶段 0：工程基础

### T0001：初始化 pnpm workspace

**目标**：建立空的多包工作区。

**产物**：

- 根 `package.json`。
- `pnpm-workspace.yaml`。
- `tsconfig.base.json`。
- `apps/` 和 `packages/` 中的空包。

**测试**：

- `pnpm install` 成功。
- `pnpm -r exec tsc --noEmit` 能运行。

**不包含**：VS Code Extension 代码、React UI、模型 SDK。

### T0002：配置质量工具

**目标**：建立统一的格式、lint 和类型检查命令。

**开始前约束门禁**：确定仓库的文本编码、换行、忽略文件和机械格式规则；规则由工具配置执行，不在 `AGENTS.md` 中重复。

**产物**：Biome 配置、`.editorconfig`、`.gitattributes`、`.gitignore` 和根脚本 `check`、`typecheck`。

**测试**：故意制造格式或类型错误时命令失败，恢复后通过。

### T0003：配置 Vitest

**目标**：让所有纯 TypeScript 包可以运行测试。

**开始前约束门禁**：建立 `docs/testing.md`，至少定义测试分层、命名、Fake/Mock 边界、确定性要求、回归测试和异步清理规则。

**产物**：共享 Vitest 配置和一个最小 smoke test。

**验收**：`pnpm test` 成功，且确实执行了测试文件。

### T0004：建立 CI

**目标**：对 `main` 的 push 以及以 `main` 为目标分支的 pull request 自动执行 install、check、typecheck、test 和 build。

**开始前约束门禁**：明确 CI 的 pnpm 版本、frozen lockfile、最小权限、任务超时、缓存范围、第三方 Action 固定方式和 Secret 禁用规则。

**验收**：GitHub Actions 工作流语法有效；本地存在等价命令。

### 阶段 0 门禁

- 空项目可以完整安装、检查、测试和构建。
- 后续包无需复制 TypeScript 或测试配置。

---

## 阶段 1：Extension 与 Webview 外壳

### T0101：创建最小 VS Code Extension

**目标**：Extension Development Host 能激活插件。

**开始前约束门禁**：建立或更新 `docs/architecture.md`，至少定义 Extension 激活与停用生命周期、Disposable 所有权、命令命名、URI 边界、适配器职责和惰性初始化要求；长期架构红线同步到 `AGENTS.md`。

**产物**：`extension.ts`、Extension `package.json`、esbuild 配置。

**测试**：Extension 集成测试验证激活成功。

### T0102：注册 Activity Bar View

**目标**：侧边栏出现 Agent 图标和空 View。

**测试**：验证 View Provider 注册；人工确认 View 可打开。

### T0103：创建 React Webview 构建

**目标**：Vite 生成静态资源，View 显示简单页面。

**开始前约束门禁**：建立 `docs/webview.md`，至少定义状态所有权、VS Code API 单一封装、组件职责、CSS Modules、VS Code CSS Variables、无障碍要求和流式渲染约束；长期边界同步到 `AGENTS.md`。

**测试**：Webview build 成功；HTML 资源 URI 使用 `asWebviewUri`。

### T0104：配置 Webview 安全策略

**目标**：设置 nonce、CSP 和 `localResourceRoots`。

**开始前约束门禁**：建立或更新 `docs/security.md`，至少定义默认拒绝的 CSP、nonce、最小 `localResourceRoots`、本地资源 URI、远程资源限制和不可信内容消毒规则。

**测试**：生成的 HTML 包含 CSP；禁止任意内联脚本。

### T0105：建立双向消息通道

**目标**：Webview 可发送 ping，Extension 返回 pong。

**开始前约束门禁**：建立 `docs/protocol.md`，至少定义 Envelope、协议版本、消息命名、请求关联、未知消息处理、运行时校验和可序列化边界。

**测试**：Protocol 单元测试和 Controller 单元测试覆盖往返消息。

### 阶段 1 门禁

- 侧边栏可以打开。
- Webview 与 Extension 能通过已校验协议双向通信。
- Webview 不拥有文件或密钥访问能力。

---

## 阶段 2：协议和核心状态

### T0201：定义基础协议 Envelope

**目标**：所有消息都有 `type`、`requestId` 和协议版本。

**测试**：合法消息通过，缺字段或未知版本被拒绝。

### T0202：定义 Session DTO

**目标**：定义 Session ID、状态、创建时间和摘要结构。

**测试**：Schema round-trip 测试。

### T0203：定义 Chat Message DTO

**目标**：支持 user、assistant、tool 三类可持久化消息。

**测试**：每种消息合法样例和非法样例。

### T0204：建立领域事件总线

**目标**：Core 通过 EventSink 发出事件，不依赖 UI。

**测试**：CollectingEventSink 保持事件顺序。

### T0205：实现 Session 状态转换

**目标**：限制合法状态变化。

**开始前约束门禁**：明确状态机不变量，包括集中转换、非法转换失败、终态不可重新运行、取消/失败/完成分离，以及状态变化与领域事件的确定顺序；长期规则同步到 `AGENTS.md`。

**测试**：覆盖全部合法和非法状态转换。

### 阶段 2 门禁

- 协议、领域模型和 UI 模型边界明确。
- 无法通过任意对象绕过消息校验。

---

## 阶段 3：模型流式聊天

### T0301：定义 `ModelGateway`

**目标**：Core 拥有供应商无关的模型接口和事件类型。

**开始前约束门禁**：明确 Provider 只负责 SDK 适配和事件标准化，覆盖增量、Tool Call、Usage、Finish、错误转换、取消传递和 SDK 类型隔离；长期边界同步到架构文档与 `AGENTS.md`。

**测试**：FakeModelGateway 可以按指定顺序流式产生事件。

### T0302：实现单轮 Agent Runtime

**目标**：输入用户消息，消费文本增量并完成一次运行。

**测试**：文本顺序、完成状态和异常状态。

### T0303：实现取消

**目标**：运行接受 AbortSignal，取消后不再发出文本。

**测试**：流中途取消，状态变为 `cancelled`，无未处理 Promise。

### T0304：实现 OpenAI Provider Adapter

**目标**：通过 Vercel AI SDK OpenAI Provider 接入 OpenAI，并实现供应商无关的 `ModelGateway`。

**测试**：使用 mock SDK response 测试事件映射；默认测试不访问网络。

### T0305：实现 SecretStorage 适配器

**目标**：保存、读取和删除 API Key。

**开始前约束门禁**：更新 `docs/security.md`，至少定义 Secret 的命名、保存/读取/删除语义、内存生命周期、日志脱敏、错误提示和测试假密钥规则。

**测试**：使用内存 SecretStorage fake；人工验证真实 VS Code 保存流程。

### T0306：连接 Webview 流式展示

**目标**：用户提交消息，UI 通过供应商无关的运行接口按增量更新回复并可取消。

**测试**：使用确定性的模型替身，React 组件测试覆盖提交、流式增量、完成和取消；Extension Controller 测试验证运行接口装配，不依赖真实 API Key 或网络。

**不包含**：具体 Provider 的选择、模型配置、API Key 提示或真实端点烟雾测试。

### T0307：定义 Provider 配置与能力契约

**目标**：定义并实现 OpenAI、Gemini 和 OpenAI-Compatible 的供应商、模型、端点与能力配置契约，由 Extension 校验配置并选择对应的 `ModelGateway`，Core 和 Webview 不感知第三方配置格式。

**开始前约束门禁**：更新架构与安全规范，至少定义 Provider 标识、模型 ID、端点校验、Secret 引用、能力声明、缺失配置提示、默认值和配置迁移边界；远程端点默认使用 HTTPS，仅对显式本地回环地址允许 HTTP。

**测试**：覆盖 OpenAI、Gemini 和 OpenAI-Compatible 的有效配置与 Provider 选择，以及未知 Provider、缺失模型、非法端点、缺失 Secret 和能力不匹配；默认测试不访问网络。

### T0308：实现 Gemini Provider Adapter

**目标**：使用 Gemini 专用 Provider 接入 Google Gemini，将 SDK 流标准化为现有 `ModelGateway` 事件，并提供一个 Extension-owned 的安全命令将 Gemini API Key 保存到稳定的 SecretStorage 名称。

**测试**：使用 mock SDK response 覆盖文本增量、Usage、Finish、稳定错误映射和取消；命令测试覆盖密码输入、取消、空值校验、精确保存和安全错误提示；人工通过该命令将 Gemini API Key 保存到 SecretStorage，并完成一次无工具流式对话。

**不包含**：通过 OpenAI 兼容端点调用 Gemini；OpenAI 或 OpenAI-Compatible 凭据管理入口；API Key 删除或轮换 UI。

### T0309：实现 OpenAI-Compatible Provider Adapter

**目标**：接入可配置的 OpenAI 兼容端点，支持 Ollama 本地模型和用户明确配置的远程兼容服务。

**测试**：使用 mock SDK response 覆盖文本增量、Usage、Finish、稳定错误映射和取消；覆盖自定义 Base URL、模型 ID、本地 Ollama 无真实 Secret 和远程端点 Secret 读取；人工使用 Ollama 或另一个兼容端点完成一次无工具流式对话。

**不包含**：针对每个兼容服务实现供应商专用能力或保证其未声明能力与 OpenAI 完全一致。

### T0310：升级 Vercel AI SDK 7

**目标**：将模型标准化层从 Vercel AI SDK 6 升级到稳定的 AI SDK 7，并保持 Core 拥有的 `ModelGateway` 公共契约及 Provider 隔离边界不变。

**前置条件**：T0304、T0308 和 T0309 已完成；仓库继续使用 Node.js 24 和 ESM，满足 AI SDK 7 的 Node.js 22 及以上版本和 ESM-only 要求。

**产物**：将 `ai`、`@ai-sdk/openai`、`@ai-sdk/google` 和 `@ai-sdk/openai-compatible` 升级到相互兼容的稳定主版本并提交 pnpm lockfile；按照官方迁移指南将 `fullStream` 迁移为 `stream`，适配 AI SDK 7 的流事件、Usage、Finish Reason、Tool Call 和错误类型，同时确保第三方 SDK 类型不泄漏到 Core、Extension、持久化或 Webview 协议。

**测试**：三个 Provider Adapter 的 mock 测试覆盖文本增量、Usage、Finish、稳定错误映射和取消；覆盖 AI SDK 7 流事件中的正常路径、重要边界和预期失败；运行受影响包及仓库既有的 check、typecheck、test 和 build，默认测试不访问网络。

**不包含**：新增 Provider、改变 Provider 配置或 Secret 契约、实现 T0401 之后的 Tool Registry/Tool Loop、引入 AI SDK UI/Agent 抽象，或让 Core 直接依赖 AI SDK 类型。

### 阶段 3 门禁

- T0310 完成，三个 Provider Adapter 使用稳定且相互兼容的 AI SDK 7 包，并保持供应商无关的 `ModelGateway` 边界。
- 插件可以选择已有的 OpenAI Provider、新增的 Gemini 专用 Provider 或 OpenAI 兼容端点，缺失配置时给出明确提示。
- 使用当前可用凭据和端点，Gemini 与 OpenAI-Compatible 分别完成一次无工具的真实流式对话；OpenAI 的真实烟雾测试在提供有效 OpenAI API Key 时执行。
- 未声明或不受支持的 Provider 能力在发起请求前被明确拒绝。
- API Key 不出现在 Webview 状态、日志或持久化消息中。
- 请求可以可靠取消。

---

## 阶段 4：只读工具循环

这一阶段必须在 T0310 完成且 AI SDK 7 Provider 边界通过回归验证后开始。

### T0401：定义 Tool Call 和 Tool Result

**目标**：建立模型、Core 和 UI 共用的工具数据模型。

**开始前约束门禁**：明确工具名称稳定性、风险等级、输入校验、结果序列化、结构化错误、输出上限、取消和工具不得直接控制 Agent 状态等契约。

**测试**：Schema、序列化和错误结果测试。

### T0402：实现 Tool Registry

**目标**：按名称注册和查找工具，拒绝重名。

**测试**：注册、查找、重名和未知工具。

### T0403：实现 Tool Input 校验

**目标**：执行前解析模型提供的未知输入。

**测试**：缺参数、错误类型、多余危险字段。

### T0404：扩展 Agent Runtime 支持单个 Tool Call

**目标**：模型请求工具，Core 执行后将 Tool Result 回送模型。

**测试**：FakeModel 两步脚本验证完整循环。

### T0405：支持多个连续 Tool Call

**目标**：循环直到模型正常完成。

**测试**：多步顺序、工具异常、最大步数限制和取消。

### T0406：实现 Workspace Scope 校验

**目标**：工具只能访问已选工作区中的 URI。

**开始前约束门禁**：更新 `docs/security.md`，至少覆盖 URI 与路径边界、规范化、`..` 逃逸、Windows 驱动器与 UNC、多根工作区、符号链接、二进制文件和结果上限；长期安全红线同步到 `AGENTS.md`。

**测试**：拒绝 `..`、工作区外 URI 和未选择的多根工作区。

### T0407：实现 `list_files`

**目标**：列出受限数量的工作区文件。

**结果契约**：工具执行返回 JSON payload 与截断元数据，由 Core Runtime 构造并保留顶层 Tool Result `truncated` 标记；不得通过猜测 payload 字段推断截断。

**测试**：Glob、排除目录、最大结果数、多根工作区。

### T0408：实现 `read_file`

**目标**：按行范围读取文本文件并限制输出大小。

**测试**：UTF-8、空文件、范围边界、大文件和二进制文件拒绝。

### T0409：实现 `search_files`

**目标**：在工作区中查找文本并返回带行号的有限结果。

**测试**：无结果、多结果、结果截断、忽略目录和取消。

### T0410：实现 Tool Call UI 卡片

**目标**：展示工具名称、参数、运行状态、结果摘要和错误。

**测试**：组件覆盖 pending、running、success、error。

### T0411：打通只读工具的真实模型调用路径

**目标**：在 Extension 组合层注册 `list_files`、`read_file` 和 `search_files`，通过供应商无关的 Core 契约向模型声明可用工具，使真实 Provider 可以发起 Tool Call，并由现有 Runtime 执行工具、回送 Tool Result 后继续模型循环。

**前置条件**：T0404 至 T0410 已完成；现有 Workspace Scope、安全限制、Tool Registry、Tool Result 和 Tool Call UI 契约保持有效。

**产物**：Core 拥有 JSON 可序列化的供应商无关工具声明契约，并从已注册工具为每次相关模型请求提供稳定名称、描述和输入 Schema；Provider Adapter 只负责将声明翻译为 AI SDK 7 的工具配置并继续规范化 Tool Call 事件，不在 Provider 内执行工具或作策略决定；Extension 以惰性、可释放且并发安全的方式组合 Workspace adapters、三个只读工具和 Runtime，不在激活或模块导入期间扫描工作区、访问网络或初始化模型客户端；工具生命周期继续通过既有协议送达 Webview。

**测试**：Core 测试覆盖声明随模型请求进入单步及连续 Tool Call 循环；Provider mock 测试覆盖三个只读工具的声明映射、Tool Call 规范化、无工具请求、错误输入和取消，且默认测试不访问网络；Extension 集成测试验证三个工具均已注册、使用所选工作区适配器、重复初始化不会产生重复注册，并覆盖模型 Tool Call 到 Tool Result 回送及 UI 生命周期转发；在 Extension Development Host 中使用当前可用的已配置 Provider 完成一次只读工具真实调用烟雾测试。

**不包含**：新增写入或命令工具、审批策略、Provider 内工具执行、新 Provider、绕过 Workspace Scope、改变现有工具名称或输入/结果含义、让第三方 SDK 类型泄漏到 Core 或协议，以及 T0501 之后的文件修改能力。

### 阶段 4 门禁

- T0411 完成，真实 Extension 组合路径向模型声明并注册三个只读工具。
- 模型可以通过只读工具了解工作区。
- 任何工作区外读取都被拒绝。
- 工具输出不会无限进入上下文。
- 循环具有最大步数和取消机制。

---

## 阶段 5：文件修改和审批

### T0501：定义 Approval 模型

**目标**：定义请求、决定、作用域和过期状态。

**开始前约束门禁**：更新 `docs/security.md`，至少定义风险矩阵、审批与精确操作绑定、一次性消费、过期、取消、重复响应、文件变化失效，以及 UI 展示内容必须与实际操作一致；长期不变量同步到 `AGENTS.md`。

**测试**：Schema 和状态转换测试。

### T0502：实现基础 Approval Policy

**目标**：read 自动允许，write 必须询问，execute/network 默认禁止。

**测试**：每个风险等级的决策矩阵。

### T0503：实现可取消 Approval Service

**目标**：Core 可以等待 UI 决定，取消运行时审批 Promise 结束。

**测试**：批准、拒绝、取消和重复响应。

### T0504：定义内部 Text Edit 模型

**目标**：修改计划包含 URI、原始版本/Hash 和文本编辑。

**测试**：编辑范围重叠、非法范围和序列化。

### T0505：实现 `propose_file_edit`

**目标**：工具只生成修改提案，不立即写文件。

**必要契约扩展**：Core 的供应商无关 Tool Input Schema 支持描述嵌套 object 和 array，Provider Adapter 将其递归映射为 AI SDK 7 JSON Schema；该扩展仅用于表达结构化编辑输入，不改变 Provider 执行工具或决策的边界。

**产物**：模型只提供 workspace-relative path 和有界文本编辑；可信 workspace adapter 捕获 canonical URI 与当前版本/Hash，并在返回提案前复核 revision。模型不得指定可信 URI、revision 或 risk。

**测试**：合法提案、工作区外路径、过期文件版本、取消、输出边界和嵌套 Tool Schema 映射。

**不包含**：Extension 注册、Diff 展示、审批 UI、实际文件写入和 Agent Loop 接入。

### T0506：实现 Diff Presenter

**目标**：用户可以在 VS Code Diff Editor 中查看修改前后内容。

**测试**：适配器单元测试；人工验证 Diff 打开正确。

### T0507：实现审批 UI

**目标**：展示目标文件、修改摘要、查看 Diff、批准和拒绝。

**测试**：组件覆盖批准、拒绝、取消和已过期。

### T0508：实现 `WorkspaceEdit` 应用器

**目标**：批准后以单个 WorkspaceEdit 应用文本修改。

**测试**：成功修改、版本冲突、applyEdit 返回 false。

### T0509：将修改结果返回 Agent Loop

**目标**：模型得知批准、拒绝或冲突结果并可继续回答。

**必要契约扩展**：需要审批的写工具将无副作用的操作准备与批准后的授权消费分离；
`propose_file_edit` 的最终 Tool Result 使用稳定的 `approved`、`denied` 或 `conflict` 结果，
其中只有 `approved` 表示绑定的文本修改已被单次应用。该扩展不授权模型提供可信 URI、revision、
risk、审批期限或展示内容，也不改变只读、命令或网络工具的执行边界。

**测试**：三种决定的完整循环测试。

### 阶段 5 门禁

- 模型不能绕过审批直接修改文件。
- 用户可以在批准前查看准确 Diff。
- 审批后文件变化会触发冲突，不会静默覆盖。

---

## 阶段 6：会话持久化与恢复

### T0601：定义持久化目录和版本

**目标**：确定 manifest、messages.jsonl、events.jsonl 结构。

**开始前约束门禁**：建立 `docs/persistence.md` 或相应 ADR，至少定义格式版本、文件职责、JSONL 记录、兼容/迁移、尾部损坏、原子写入、Secret 排除和测试 fixture 版本规则。

**测试**：路径生成和格式版本测试。

### T0602：实现原子 Manifest Store

**目标**：通过临时文件和重命名避免半写入 manifest。

**测试**：正常写入、替换和模拟失败。

### T0603：实现 JSONL Event Store

**目标**：按顺序追加可恢复事件。

**测试**：追加、读取、空行、尾部损坏记录处理。

### T0604：实现 Session Repository

**目标**：组合 manifest 和 event store，实现 create/get/list/update。

**测试**：InMemory 与文件实现通过同一契约测试。

### T0605：接入 `storageUri`

**目标**：Extension 使用工作区私有存储保存会话。

**测试**：无工作区时给出明确处理；有工作区时可以创建目录。

### T0606：实现会话列表和恢复

**目标**：Webview 可以选择已有会话并恢复消息。

**测试**：排序、空列表、损坏会话隔离和恢复 UI。

### T0607：恢复中断运行

**目标**：重启后将 running/awaiting 状态归一化为 interrupted，不自动继续危险操作。

**必要契约扩展**：`interrupted` 是持久化恢复专用终态；所有非终态恢复为
`interrupted`，Live Runtime 不能转换进入或离开该状态，恢复不得继续模型、审批或工具操作。

**测试**：每个非终态的恢复规则。

### 阶段 6 门禁

- VS Code 重启后历史消息存在。
- 损坏单个会话不会导致整个扩展无法启动。
- 中断的审批或工具不会在重启后自动执行。

---

## 阶段 7：上下文与可靠性

### T0701：实现 Token Budget 接口

**目标**：根据模型上下文窗口分配 System、History、Files、Tools 预算。

**开始前约束门禁**：明确所有上下文预算和恢复动作的硬上限、确定性计算、Tool Call/Result 配对、显式截断标记、最近用户意图保留和摘要安全规则。

**测试**：边界和预算总和测试。

### T0702：实现工具输出截断

**目标**：所有工具输出具有字符、行数和条目上限，并明确标记截断。

**测试**：每类上限及截断标识。

### T0703：实现历史裁剪

**目标**：保留 System、最近用户意图和完整 Tool Call/Result 配对。

**测试**：不能产生孤立 Tool Result。

### T0704：定义摘要器接口

**目标**：将旧对话转换为可持久化摘要。

**测试**：使用 FakeSummarizer，不访问真实模型。

### T0705：实现上下文超限恢复

**目标**：超限时最多执行有限次数的裁剪/摘要重试。

**测试**：成功恢复和超过最大重试次数。

### T0706：实现 Tool Repetition Detector

**目标**：相同工具和参数连续出现达到阈值时暂停循环。

**测试**：相同、不同参数、交错调用和阈值。

### T0707：实现 Provider 重试策略

**目标**：只重试明确可重试错误，支持退避和取消。

**测试**：限流、服务错误、认证错误、取消。

### 阶段 7 门禁

- 长会话不会无限增长。
- Tool Call 和 Tool Result 始终成对。
- 重试、裁剪和重复检测都有硬上限。

---

## 阶段 8：Checkpoint 和撤销

### T0801：定义 Checkpoint 模型

**目标**：记录变更前内容、Hash、变更后 Hash 和所属 Run。

**开始前约束门禁**：更新持久化与安全规范，至少定义 Checkpoint 创建先于写入、before/after Hash、Run 归属、恢复前置条件、冲突处理和多文件操作的原子性边界；不提前引入未规划的保留策略。

**测试**：序列化和完整性校验。

### T0802：在应用修改前创建 Checkpoint

**目标**：未成功创建 Checkpoint 时不应用修改。

**测试**：创建失败阻止写入。

### T0803：实现安全恢复

**目标**：当前文件仍匹配 afterHash 时才自动恢复。

**测试**：正常恢复、用户后续修改导致冲突。

### T0804：实现 Checkpoint UI

**目标**：用户可以查看并请求恢复某次 Agent 修改。

**测试**：组件状态和 Extension 集成烟雾测试。

### 阶段 8 门禁

- Agent 文件修改可以恢复。
- 恢复不会覆盖 Agent 修改后用户手动产生的变化。

---

## 阶段 9：命令执行

这一阶段必须在文件审批和取消机制稳定后开始。

### T0901：定义 Command Tool Schema

**目标**：参数明确包含命令、工作目录、超时。

**开始前约束门禁**：独立更新 `docs/security.md` 和 `AGENTS.md`，至少定义逐次审批、完整命令与 cwd 展示、shell/spawn 语义、命令拼接限制、环境变量最小继承与脱敏、工作区信任、硬超时、输出上限、取消时终止进程树和跨平台测试要求。

**测试**：拒绝空命令、工作区外 cwd 和非法超时。

### T0902：实现命令审批策略

**目标**：所有命令默认逐次审批，展示完整命令和 cwd。

**测试**：批准、拒绝、取消和过期请求。

### T0903：实现 Spawn Command Runner

**目标**：流式捕获 stdout、stderr、exit code，并支持取消和超时。

**测试**：使用固定测试进程验证所有事件；覆盖 Windows/macOS/Linux 差异。

### T0904：实现输出限制

**目标**：内存和上下文中的命令输出都有硬上限，完整日志可选落盘。

**测试**：大量输出不会造成无限内存增长。

### T0905：实现命令 Tool UI

**目标**：展示审批、运行状态、输出、退出码和终止按钮。

**测试**：组件覆盖完整生命周期。

### T0906：接入 Workspace Trust

**目标**：不受信任工作区禁用命令执行和文件写入。

**产物**：声明对不受信任工作区的有限支持；Extension Host 将 Workspace Trust
策略接入工具注册、审批消费和副作用执行边界；完成前序任务已实现的命令 Tool、审批、
Runner、输出限制和 UI 的运行时组合。为把执行结果交还模型与 UI，可以最小扩展 Core 的
审批消费结果，但不得更改工具名、Webview 协议或持久化格式。

**测试**：信任状态策略测试；覆盖不受信任时危险工具不可用、审批后信任失效无副作用、
命令输出回传；人工验证授权后更新。

### 阶段 9 门禁

- 未批准命令无法执行。
- 命令可以终止和超时。
- 输出大小受控。
- 不受信任工作区禁止执行类能力。

---

## 阶段 10：发布准备

### T1001：实现结构化日志

**目标**：使用 VS Code LogOutputChannel，统一字段并脱敏。

**开始前约束门禁**：更新 `docs/security.md`，定义结构化日志字段、关联 ID、敏感字段清单、用户源码与模型内容的默认排除、第三方错误 cause 处理，以及用户提示与诊断日志的边界。

**测试**：API Key、Authorization Header 和用户 Secret 不进入日志。

### T1002：完善错误分类和用户提示

**目标**：认证、网络、限流、上下文、工具和内部错误具有不同提示。

**测试**：错误到 UI DTO 的映射测试。

### T1003：性能基线

**目标**：记录激活时间、Webview 首次显示时间和空闲内存基线。

**验收**：扩展启动时不初始化模型客户端或扫描整个工作区。

### T1004：生成 VSIX

**目标**：使用 `@vscode/vsce` 生成可安装包。

**开始前约束门禁**：明确 VSIX 文件 allowlist/ignore、Source Map 策略、生产/开发依赖边界、禁止内容、产物体积检查、Git commit 可追溯性，以及禁止从脏工作区生成正式包。

**测试**：在干净 VS Code Profile 中安装并完成 smoke test。

### T1005：发布检查清单

**目标**：完成 README、隐私说明、许可证、配置项说明和已知限制。

### 阶段 10 门禁

- 干净环境可安装和运行。
- VSIX 不包含源码缓存、测试数据、API Key 或无关依赖。
- README 中的完整入门路径可复现。

## 11. 后续能力候选顺序

第一版发布后，建议按以下顺序评估：

1. 更多专用模型供应商，继续验证 Provider 边界。
2. Plan/Act 模式，验证 Tool Policy 可配置性。
3. 项目级规则文件。
4. MCP Client。
5. Git 状态感知和提交辅助。
6. 代码语义索引。
7. 多 Agent。

多 Agent 必须建立在可恢复 Session、确定性 Tool 生命周期和资源隔离之上。

## 12. 任务执行模板

后续每次开始一个任务时使用以下模板：

```md
### 当前任务

- ID：Txxxx
- 状态：进行中（同步任务状态台账）
- 目标：
- 前置条件：
- 计划修改的文件：
- 明确不做：

### 测试计划

- 单元测试：
- 集成测试：
- 人工烟雾测试：

### 约束门禁

- 需要新建或更新的规范：
- 必须覆盖的规则：
- 是否需要独立约束 PR（docs-only / config-only）：

### 完成结果

- 实现摘要：
- 测试结果：
- 设计偏差：无 / 说明
- 完成 PR：
- 完成日期：
- 下一任务：
```

## 13. 变更控制

如果实施中需要改变模块边界、技术基线或任务顺序：

1. 先说明当前任务遇到的具体证据。
2. 写出至少一个替代方案和影响。
3. 更新本文档，再修改代码。
4. 不以“顺手重构”为理由扩大当前任务范围。

新增需求默认进入后续候选清单，不直接插入正在执行的最小任务。

## 14. 第一个执行点

从 **T0001：初始化 pnpm workspace** 开始。

T0001 完成前不安装 React、模型 SDK、VS Code 测试框架或任何业务依赖。这样可以保证第一个任务只验证 Workspace 结构和 TypeScript 基线。
