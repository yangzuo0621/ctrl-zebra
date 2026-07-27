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
- `已转任务`：已收敛并转化为具体的 Roadmap Task。
- `已归档`：已被规范 ([ux.md](../ux.md)) 吸收合并，或决定不处理。

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
  - 确定有效的交互规则（Inline Approval Fusion、原始 JSON 渐进披露）已写入 [ux.md](../ux.md) 2.3 及第 5 节。
  - 待后续在更多复杂/高风险操作场景下进一步走查用户体验。
