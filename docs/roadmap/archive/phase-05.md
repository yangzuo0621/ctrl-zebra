# 阶段 5：文件修改和审批

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

> 本阶段已完成。任务状态与完成证据以 [实施计划索引](../../implementation-plan.md) 中的任务台账为准；正常执行新任务时无需读取本归档。
