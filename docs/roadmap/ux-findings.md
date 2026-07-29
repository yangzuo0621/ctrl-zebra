# CtrlZebra — UX 发现与演进台账 (UX Findings Ledger)

## 1. 定位与维护规则

本文档记录在 Webview 持续演进过程中的 UX 观察、问题线索、Gemini 交互微调、用户反馈以及待验证设想。

- **与 `docs/ux.md` 的区别**：[ux.md](../ux.md) 是当前生效的唯一权威体验规范；本文档是演进缓冲区与探索记录，不直接作为界面定义。
- **与 Roadmap Task 的关系**：本文档中的条目可以随时追加，**“记录”不代表马上实施**。当积累的发现已比较确定并需要代码实施时，再组织为有清晰完成定义 (DoD) 的 Roadmap Task。
- **与 Standalone Maintenance 的界限**：纯行为保持的样式与表现调整走 Standalone Maintenance；改变用户行为或决策流（如数据展示层级、审批信息隐藏）的微调，需先在本文档记录并在确定后通过 Task 实施。

---

## 2. 状态定义

- `观察中`：初次记录的现象或设计设想，尚需收集更多场景或反馈。
- `待验证`：已完成代码调整或已实现初步方案，正等待可用性走查或用户验证。
- `已确认回归`：涉及现有安全或架构契约违例的确认缺陷，需强制独立开辟修复 Task。在修复 Task 创建并明确边界后转换为 `已转任务`。
- `已转任务`：已收敛或已确认需修复，并已转化为具体的 Roadmap Task。
- `已归档`：已被规范 ([ux.md](../ux.md)) 吸收合并、修复合入主干，或决定不处理。

---

## 3. 演进与追溯条目

### UX-001：审批卡与 Tool 卡层级合并及原始 JSON 隐藏

- **状态**：`待验证`
- **发现来源**：PR #122–#126 交互微调
- **背景与改动**：
  - 隐藏了审批状态下展示的部分原始参数 JSON，优先呈现面向用户的操作动作与风险摘要。
  - 将审批交互直接嵌入 Tool 卡内，保持消息流就近呈现。
  - 调整了动态信息的自动折叠顺序。
- **影响场景**：文件修改审批、命令执行审批。
- **关联 PR**：[#122](https://github.com/yangzuo0621/ctrl-zebra/pull/122), [#123](https://github.com/yangzuo0621/ctrl-zebra/pull/123), [#124](https://github.com/yangzuo0621/ctrl-zebra/pull/124), [#125](https://github.com/yangzuo0621/ctrl-zebra/pull/125), [#126](https://github.com/yangzuo0621/ctrl-zebra/pull/126)
- **验证与规范状态**：
  - [ux.md](../ux.md) 2.3 与第 5 节已更新，精准同步当前已落地的 UI 行为（待审批状态下通过 Inline Approval Fusion 置换隐藏原始 Tool JSON 参数，优先呈现操作动作、结构化 URI、Diff 与时效）。
  - **待验证项（保留在台账中）**：在复杂或高风险操作决策中，用户是否需要在待审批卡片内提供额外的嵌套展开控件以查看完整原始 Tool JSON 参数。由于目前尚缺乏可用性走查与用户验证证据，该项保持 `待验证` 状态，不作为已确认规则。

### UX-002：PR #126 嵌式审批卡隐去风险等级标识（确定性安全回归）

- **状态**：`已转任务`
- **发现来源**：PR #126 / PR #128 Review 审查 ([security.md](../security.md) 强制契约校验)
- **问题定义与契约冲突**：
  - [security.md](../security.md) 明确规定：审批 UI 为不可变 Request 的安全投影，必须展示包含工具/效果、目标资源、工作区、**风险** (`risk`)、有效时间及 Diff 在内的完整边界。
  - 在 PR #126 引入的 Inline Approval Fusion 模式下（`embedded` 为 true），`ApprovalCard` 隐藏了头部包含的 `write`/`execute` 风险等级 Badge，外层卡片 Badge 仅显示 `Awaiting Decision`。
  - 此项隐去风险标识的行为违反了 [security.md](../security.md) 的强制安全边界要求，属于 PR #126 引入的**确定性安全/规范回归**，不能作为可选 UX 设想进行延迟评估，也不能在 [ux.md](../ux.md) 中被正当化。
- **影响场景**：文件修改审批、命令执行审批。
- **关联 PR**：[#126](https://github.com/yangzuo0621/ctrl-zebra/pull/126), [#128](https://github.com/yangzuo0621/ctrl-zebra/pull/128)
- **后续处理**：
  - [ux.md](../ux.md) 保持 [security.md](../security.md) 的安全要求，明确规定待审批呈现必须包含显性风险等级标识。
  - 已转为 [T1201](phases/phase-12.md#t1201恢复内嵌审批风险等级标识)，在内嵌审批卡片中恢复显式的 `write`/`execute` 风险等级标识。
