# 阶段 10：发布准备

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

### T1006：限制无关工具调用并保证可见完成结果

**目标**：修复普通问候触发无关工作区工具链且最终没有文本响应的问题。

**前置条件**：T0401 至 T0509 的 Tool Runtime、Approval Policy 和命令执行边界保持有效；T1002 的错误 DTO 分类保持兼容。

**开始前约束门禁**：Core 必须通过 `ModelRequest.instructions` 向每次模型请求提供稳定的系统指令，Provider 将它映射到 AI SDK 7 的顶层 `instructions`，不得把新系统指令伪装成 `messages` 中的用户或系统历史。指令要求仅在用户请求确实需要时检查、测试、修改或执行工作区操作。对于可被严格识别为纯问候或简单对话的输入，Core 不向 Provider 声明工具，并拒绝执行 Provider 未获声明的 Tool Call。该门禁只做保守的无工具判定；不得用宽泛关键词推断复杂用户意图。

**完成不变量**：没有 Tool Call 的最终模型步骤必须产生至少一个非空白文本增量，Runtime 才能进入 `completed`。工具执行后的最终模型步骤同样必须产生非空白文本；空响应以稳定 Core 错误失败。达到最大 Tool 步数时，在执行越界 Tool Call 前失败，并向 UI 映射包含明确步数上限的安全提示。

**测试**：覆盖问候不声明或执行工具、合法只读任务仍声明并执行工具、审批工具仍走单次审批、Provider 返回未声明 Tool Call、工具后空最终响应、直接空响应、最大 Tool 步数、取消以及审批回归。

**不包含**：更改 Tool 名称、输入输出 DTO、风险级别、审批绑定、取消语义或 Provider SDK；引入意图分类模型、Plan/Act 模式、可配置 Tool Policy 或自动提高工具权限。

### T1007：修复 Gemini 失败分类与安全诊断

**目标**：让已配置的 Gemini 请求成功完成真实流式对话，并把 Provider 拒绝或失败映射为稳定、可操作且不泄密的用户提示与结构化诊断，避免统一显示为内部错误。

**前置条件**：T0308 的 Gemini Provider Adapter、T1002 的错误 DTO 分类和 T1006 的请求指令与完成不变量保持兼容；T1006 已由 PR #104 完成。

**开始前约束门禁**：Provider 只能依据 AI SDK 的类型化错误、HTTP 状态和经过收窄的枚举状态分类，不得匹配第三方错误 message。Core 错误类别必须区分认证、权限拒绝、模型不存在、限流、无效请求、不可用、响应畸形和未知失败；SDK 类型、原始响应、URL、Headers、请求体和错误正文不得越过 Provider 边界。Google 对无效凭据可能返回 `400/INVALID_ARGUMENT`，因此该提示必须安全地要求同时检查密钥、模型和端点，不能把 400 断言为单一认证原因。

**诊断不变量**：Extension 只记录固定事件名、组件、稳定 Core 错误类别和结果；不得记录 Error message、stack、API Key、Authorization Header、Provider 响应正文或请求内容。Webview 继续使用现有 Run Error DTO，不扩展协议字段；模型不存在、权限拒绝、无效请求和响应畸形通过固定安全文案提供可操作反馈。

**测试**：覆盖 AI SDK 流内与同步错误的 400、401、403、404、429、可重试及 5xx 映射；覆盖 Gemini 认证/权限、模型不存在、无效请求、限流、不可用、响应畸形和未知失败的用户提示；验证结构化日志只包含固定安全字段。人工使用临时 Auth Key 完成一次无工具 `hello` 和一次合法只读工具请求，测试后撤销密钥。

**不包含**：记录或解析第三方错误消息、自动探测模型列表、自动修改 Provider 配置、密钥管理 UI 重做、Provider SDK 升级或改变 Webview/Extension 协议。

### T1008：修复 Provider 配置错误的用户提示

**目标**：在 Provider 配置缺失或无效时阻止请求进入 Provider，并通过固定、可操作且脱敏的 Webview 错误解释需要修正的设置，避免统一显示为内部错误。

**前置条件**：T1002 的 Run Error DTO、T1007 的安全运行失败日志和现有 Provider Configuration 边界保持兼容。

**开始前约束门禁**：在 Run Error DTO 中新增加法类别 `configuration`，用于区分本地 Provider 设置失败与认证、网络、限流、上下文、工具和内部错误。Extension 只能依据 `ProviderConfigurationError.code` 选择固定文案，不得转发异常 message、setting 值或任何配置内容。缺失 API Key 继续归类为 `authentication`。

**用户提示不变量**：`missing-model` 必须显示 `Configure a model ID before starting a chat.`；unknown provider、invalid model、missing endpoint、invalid endpoint 和 invalid capabilities 分别使用固定安全文案。Webview 继续只呈现协议内的安全 message，不读取本地设置或 Provider 凭据。

**测试**：覆盖六种 `ProviderConfigurationError` 的协议类别、固定文案和脱敏性质；覆盖缺失 API Key 仍为认证错误；覆盖 `configuration` Run Error DTO 的协议往返，并在无 Provider 设置的隔离 VS Code profile 中验证 `hello` 在 Provider 调用前失败且显示精确提示。

**不包含**：自动修改 Provider 设置、自动选择模型或端点、设置 UI 重做、Provider 请求探测、SDK 升级、记录原始异常消息或扩展其他协议字段。

### 阶段 10 门禁

- 干净环境可安装和运行。
- VSIX 不包含源码缓存、测试数据、API Key 或无关依赖。
- README 中的完整入门路径可复现。

> 本阶段已完成。任务状态与完成证据以 [实施计划索引](../../implementation-plan.md) 中的任务台账为准；正常执行新任务时无需读取本归档。
