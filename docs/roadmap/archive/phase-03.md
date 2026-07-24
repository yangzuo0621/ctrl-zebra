# 阶段 3：模型流式聊天

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

> 本阶段已完成。任务状态与完成证据以 [实施计划索引](../../implementation-plan.md) 中的任务台账为准；正常执行新任务时无需读取本归档。
