# 阶段 20：文件生命周期与工作区编辑

> **归档状态：阶段性归档校验通过**
>
> - 归档日期：2026-08-14
> - 完成任务：T2001–T2005；任务已通过 [PR #227](https://github.com/yangzuo0621/ctrl-zebra/pull/227)（squash merge `797ed9e58887021d0b2c09043783e8c5bae92ad5`）、[PR #229](https://github.com/yangzuo0621/ctrl-zebra/pull/229)（`fbbcf55dce499dcf887c1e645c45d16a62ab5d1d`）、[PR #232](https://github.com/yangzuo0621/ctrl-zebra/pull/232)（`07bbf9a2cf3b53e7b532cc6e875574022e27e4ad`）、[PR #235](https://github.com/yangzuo0621/ctrl-zebra/pull/235)（`65cda309cd52bc2571c078292484274f7934383e`）和 [PR #238](https://github.com/yangzuo0621/ctrl-zebra/pull/238)（`21f62b2db044e246c97afa61245896e323287b81`）合并到 `main`。
> - 阶段完成基线：`21f62b2db044e246c97afa61245896e323287b81`（归档校验开始时 `main` 与 `origin/main` 一致且工作区 clean）。
> - 阶段 20 归档门禁 PR：[ #239](https://github.com/yangzuo0621/ctrl-zebra/pull/239)；T2101 只在该 PR 合并后可开始。
> - 阶段门禁：创建、删除、重命名和多文件编辑均通过精确单次审批、Trust/范围/目标身份/批准内容的副作用前复核；删除、重命名和覆盖的不可变 Checkpoint 支持恢复且排除秘密、二进制和超限内容；多文件编辑在前置验证失败时零写入并由 Host-owned 原子 `WorkspaceEdit` 提交；正则搜索保持 literal 默认行为并使用受控 RE2-compatible 模式与复杂度、取消和结果边界。单元、适配器、Extension 集成、VSIX 打包与烟雾验证均通过。
> - 跨边界一致性：`docs/architecture/tools-and-files.md`、`docs/protocol/tools-and-file-lifecycle.md`、`docs/security.md`、`docs/persistence.md`、`docs/ux.md`、`docs/webview.md`、`docs/roadmap/product-foundation.md`、Protocol Schema、Core/builtin Tool 注册、Extension workspace adapters、Approval/Checkpoint workflows 与 Webview Diff/approval projection 保持文件生命周期、Trust、URI、审批、取消、原子性、恢复、预算和不可信内容边界一致。
> - 验证证据：聚焦的 T2002–T2005 测试、`pnpm run test:unit`（T2003 修复 PR #238：180 个文件 / 1,926 tests）、`pnpm run typecheck`、`pnpm run check`、Extension/Webview build、`pnpm run test:integration`、`pnpm run package:vsix`、`pnpm run smoke:vsix`、`git diff --check` 以及 PR #227/#229/#232/#235/#238 的 Ubuntu、macOS、Windows CI 均通过。VS Code 测试环境仅报告既有非失败 warning；非交互环境未执行人工创建/删除/重命名/恢复路径。
> - 后续门禁：Phase 20 归档合入前不得启动 T2101；归档后执行点为 T2101。

## 1. 阶段目标

让 Agent 能以用户可审阅、精确单次批准且可恢复的方式创建、删除、重命名和原子修改多个工作区
文本文件，并为只读搜索提供受控正则能力。

## 2. 前置条件与范围

- 阶段 19 已完成。
- Workspace Trust、规范 URI、审批、Checkpoint 和写前复核继续是唯一副作用边界。
- T2001 的独立 docs-only 约束 PR 必须先更新架构、协议、安全、持久化、UX 和 Webview。
- 每种写操作的批准绑定完整不可变计划；重试、修改、取消、过期或消费后必须重新批准。

本阶段不包含工作区外操作、二进制文件、目录递归删除、无审批写入、Git commit/PR、shell 文件操作、
批量永久授权或模型自行回滚。

## 3. 任务

### T2001：确定文件生命周期与多文件原子契约

定义 Tool/DTO 名称、输入上限、冲突和 stale 检查、审批摘要、Diff、Checkpoint 数据、原子提交、
失败优先级、恢复和兼容规则。比较扩展现有 Tool 与新增 Tool 的影响，获批后再固定公共契约。

### T2002：实现受控文件创建

提议创建新的 UTF-8 文本文件；拒绝已存在目标、越界 URI、二进制/超限内容和不可信工作区；批准前
展示完整内容；写前再次验证目标仍不存在；Checkpoint 支持恢复到“不存在”。

测试正常创建、已存在、父路径、符号链接/大小写边界、批准失效、竞态、取消和恢复。

### T2003：实现受控删除与重命名

删除只支持明确单个文本文件并保存完整可恢复原文；重命名同时绑定源、目标和源内容身份，拒绝覆盖。
测试不存在、目标冲突、stale、跨根、大小写、批准后变化、部分失败、取消和 Checkpoint 恢复。

### T2004：实现多文件原子编辑

用一个不可变计划、一个可审阅的分文件 Diff 和一个审批覆盖多个已验证目标；立即写前复核全部目标；
通过 Host-owned 原子 WorkspaceEdit 提交；任何前置失败均不得产生部分写入。Checkpoint 覆盖完整文件集。

测试多文件成功、任一文件 stale、重复目标、重叠编辑、创建/修改组合边界、审批篡改、应用失败、
取消、恢复和序列化结果上限。

### T2005：为搜索增加受控正则模式

在不改变默认精确子串行为的前提下增加显式正则模式；采用可证明的超时/步数/复杂度边界，危险或
不受控模式拒绝而不是阻塞 Extension Host。测试普通模式、无效模式、灾难性回溯样例、Unicode、
文件/结果/时间上限、取消和截断标志。

## 4. 阶段门禁

- 每个写操作都绑定精确单次审批，并在副作用前重新检查 Trust、范围、目标身份和批准内容。
- 删除与覆盖前的内容可由不可变 Checkpoint 恢复；秘密、二进制和超限数据不进入记录。
- 多文件操作在前置验证失败时零写入，应用结果与文档声明的原子语义一致。
- 正则搜索不会允许不受控 CPU/内存消耗，并保持现有截断语义。
- 单元、适配器、Extension 集成、VSIX 烟雾和人工创建/删除/重命名/恢复路径通过。
