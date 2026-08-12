# Roadmap 任务执行模板

后续每次开始一个任务时使用以下模板；状态只在 [实施计划索引](../implementation-plan.md) 的任务台账中维护。

Reuse Before Build 与 Build vs Buy 遵循根 [`AGENTS.md`](../../AGENTS.md) 的强制原则和
[`Reuse Before Build`](../development.md#reuse-before-build) 及
[`Build vs Buy`](../development.md#build-vs-buy) 评估细则，实现与审查证据按
[`Implementation Review Checklist`](../review-checklist.md) 复核。

```md
### 当前任务

- ID：Txxxx
- 状态：进行中（同步任务状态台账）
- 目标：
- 前置条件：
- 计划修改的文件：
- 明确不做：

### Reuse Audit

- 计划新增的行为与符号：
- 初始全仓搜索命令、关键词与 engineering-opportunity 记录：
- 找到的现有实现（路径、符号、语义 owner）：无 / 列出
- 决定：直接复用 / 深化现有模块 / 新建实现 / 不适用
- 未复用理由：
- 是否形成第二份或第三份实现：否 / 说明所有权或语义差异
- 执行中将主动调用或深化的已有功能：

### Build vs Buy

- 涉及的通用机制：无 / 说明
- 触发条件：无 / 依赖变更 / 通用算法超过约 100 行 / 已重复实现 / 需要大量算法边界测试 / 其他
- 标准库或 VS Code API：
- 现有依赖：
- 官方 SDK 或第三方候选：
- 决定：复用 / 引入依赖 / 自研 / 不适用
- 理由与证据：
- 影响：维护、许可证、运行时兼容、包体积、取消与安全
- 隔离边界：CtrlZebra-owned interface / 不适用

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
- Similarity Audit：最终全仓复查命令；每个实际新增/修改符号的定义位置、数量、owner 与处置；
  reviewer 独立复查差异
- 实际直接复用或深化的已有功能：
- 删除或替代的旧实现：无 / 列出
- 设计偏差：无 / 说明
- 完成 PR：
- 完成日期：
- 下一任务：
```
