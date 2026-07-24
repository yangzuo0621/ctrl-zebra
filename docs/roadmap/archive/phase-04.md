# 阶段 4：只读工具循环

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

> 本阶段已完成。任务状态与完成证据以 [实施计划索引](../../implementation-plan.md) 中的任务台账为准；正常执行新任务时无需读取本归档。
