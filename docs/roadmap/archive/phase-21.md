# 阶段 21：对话交互与会话数据控制

> **归档状态：阶段性归档校验通过**
>
> - 归档日期：2026-08-16
> - 完成任务：T2101–T2106；任务已通过 [PR #240](https://github.com/yangzuo0621/ctrl-zebra/pull/240)（squash merge `aa58c326941e4a5534fa881b0150d8e57a13945b`）、[PR #242](https://github.com/yangzuo0621/ctrl-zebra/pull/242)（`cd6956f81bd759298acbd7e69e581acc6295b9ad`）、[PR #244](https://github.com/yangzuo0621/ctrl-zebra/pull/244)（`15121a30ddeda7004ab41bfa17efd9550e6e3427`）、[PR #245](https://github.com/yangzuo0621/ctrl-zebra/pull/245)（`bd5c5595da1971b7e4e5003d62a6c2ba9de6e0d3`）、[PR #248](https://github.com/yangzuo0621/ctrl-zebra/pull/248)（`dea09405579a302d2427b53b4f3e9cf6e2d2e276`）和 [PR #250](https://github.com/yangzuo0621/ctrl-zebra/pull/250)（`fc5951776bc80862a3b0413d93c7d44f6df655cf`）合并到 `main`。
> - 阶段完成基线：`fc5951776bc80862a3b0413d93c7d44f6df655cf`（归档校验开始时 `main` 与 `origin/main` 均已包含 T2106 完成状态，工作区 clean）。
> - 阶段 21 归档门禁 PR：[ #252](https://github.com/yangzuo0621/ctrl-zebra/pull/252)；阶段 22 的 T2201 只在本 PR 合并后可开始。
> - 阶段门禁：重新生成和编辑重发创建新的 Run/分支结果，不重复旧 Tool side effect、复用审批或篡改源事件；工作区文件引用只读取已选工作区内有界文本并在发送前可见；会话删除、全部清空和保留策略覆盖 Session、Checkpoint、临时文件和索引记录且不静默处理运行中数据；清除全部本地 CtrlZebra 数据覆盖已清单化的 CtrlZebra-owned 状态，部分失败可诊断并安全重试，不删除工作区文件、用户代码、VS Code 全局数据或其他扩展状态。
> - 跨边界一致性：`docs/architecture/context-and-session.md`、`docs/architecture/lifecycle.md`、`docs/protocol/session-and-runtime.md`、`docs/protocol/ide-context.md`、`docs/security.md`、`docs/persistence.md`、`docs/configuration.md`、`docs/ux.md`、`docs/webview.md`、`PRIVACY.md`、Protocol Schema、Core/Extension storage and recovery adapters、Webview session/file-reference/local-data projections 保持分支 Run、事件源、文件 URI/Trust/预算、删除/保留/清除、取消、恢复、秘密和不可信内容边界一致。
> - 验证证据：T2101–T2106 聚焦测试、`pnpm run test:unit`、`pnpm run typecheck`、`pnpm run check`、Extension/Webview build、`pnpm run test:integration`、`pnpm run package:vsix`、`pnpm run smoke:vsix`、`git diff --check` 以及对应 PR 的 Ubuntu、macOS、Windows CI 均通过；非交互环境未执行需要真实 VS Code/用户数据的手工卸载路径。
> - 后续门禁：Phase 21 归档合入前不得启动 T2201；归档后执行点为 T2201。

## 1. 阶段目标

在多轮 Session 已稳定的基础上补齐重新生成、编辑重发和工作区文件引用，并让用户能够删除会话、
清空本地历史、控制保留期限，并在卸载或移交设备前清除全部本地 CtrlZebra 数据。

## 2. 前置条件与范围

- 阶段 15–20 已完成。
- 重新生成和编辑重发必须创建明确的新 Run/分支结果，不原地篡改已经提交的事件历史。
- 工作区文件引用继续服从 URI 范围、二进制拒绝、Token 预算和普通不可信上下文规则。
- 删除与保留只由用户或明确配置触发，必须覆盖 Session 与其拥有的 Checkpoint、临时文件和索引记录。

本阶段不包含运行中插话、任意历史分支浏览、跨会话记忆、云同步、撤销已发生的外部副作用、
删除工作区文件或自动把历史上传到诊断/遥测服务。

## 3. 任务

### T2101：重新生成上一条助手回复

定义重新生成的 Run、历史输入、旧回复保留/替换投影、取消和审批语义；用户操作前显示作用范围；
不得重复执行旧 Tool side effect 或复用批准。测试纯文本、含 Tool 回合、取消、失败、快速重复操作、
恢复和迟到事件。

### T2102：编辑历史用户消息并重发

编辑产生新的用户输入和 Run，不改写持久化源事件；明确后续旧消息如何从新分支上下文排除；
不自动执行。测试首条/中间/最新消息、含 Tool 历史、空内容、超限、取消、恢复和分支错配。

### T2103：实现 `@` 工作区文件引用

提供用户可见的文件选择与引用投影；读取发生在 Host 边界并使用阶段 19 的 URI、Trust 和上下文
规则；发送前可移除；文件变化或删除有明确 stale 处理。测试搜索、键盘、重复引用、越界、二进制、
超限、符号链接、变更竞态和 Token 截断。

### T2104：实现会话删除与全部清空

先更新持久化、安全、Protocol 和 UX 契约。删除覆盖 Session manifest、消息、事件、推理投影、
Checkpoint 和临时文件；运行中会话必须先确定性取消；部分失败可诊断并可安全重试；Webview 不能
继续展示已删除会话。测试单个/全部、运行中、损坏记录、部分失败、重启、并发恢复和路径边界。

### T2105：实现可配置的会话保留策略

定义默认保留行为、关闭自动清理、时间计算、受保护运行中会话、清理触发点和用户反馈；使用注入
时钟并有界扫描；不静默删除仍在运行或恢复中的数据。测试边界日期、时区无关、禁用、空仓库、
大量会话、清理失败、取消和 Checkpoint 归属。

### T2106：实现清除全部本地 CtrlZebra 数据

先建立完整数据清单和删除顺序，提供明确的高风险确认，覆盖 Session、Checkpoint、临时文件、缓存、
Provider Secret、MCP/Provider 用户配置和其他 CtrlZebra-owned 本地状态。运行中操作先确定性取消并
完成资源清理；部分失败必须逐类报告且可安全重试；不删除工作区文件、用户代码、VS Code 全局数据
或其他扩展状态。测试空状态、全部类别、SecretStorage/文件/配置部分失败、运行中、重启、并发调用、
幂等重试和卸载前文档路径。

## 4. 阶段门禁

- 重新生成和编辑重发不会重复旧 Tool side effect、复用审批或篡改源事件。
- 文件引用只读取已选工作区内有界文本，并在发送前对用户可见。
- 用户可以删除单个会话和全部本地历史；删除后的投影、Checkpoint 和临时数据不残留。
- 保留策略可关闭、可预测、可测试，不删除运行中数据。
- 用户可以在卸载前清除全部 CtrlZebra-owned 本地数据，部分失败不会被报告为成功。
- Protocol、持久化、安全、隐私、UX 和恢复文档与实现一致。
