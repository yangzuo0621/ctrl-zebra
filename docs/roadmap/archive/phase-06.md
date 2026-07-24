# 阶段 6：会话持久化与恢复

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

> 本阶段已完成。任务状态与完成证据以 [实施计划索引](../../implementation-plan.md) 中的任务台账为准；正常执行新任务时无需读取本归档。
