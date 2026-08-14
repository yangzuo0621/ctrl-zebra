# T2001 文件生命周期契约审计（历史执行记录）

> 本文件是 T2001 的非权威历史执行记录，不维护任务状态、当前执行点或当前契约。
> 冲突时以 [`implementation-plan.md`](../implementation-plan.md) 的状态台账、[阶段 20 归档规格](../roadmap/archive/phase-20.md)
> 及其引用的领域文档为准。契约正文仍由 [Protocol T2001](../protocol/tools-and-file-lifecycle.md#file-lifecycle-and-atomic-mutation-contracts-t2001)、
> [Architecture T2001](../architecture/tools-and-files.md#file-lifecycle-and-atomic-workspaceedit-boundary-t2001)、
> [Security T2001](../security.md#file-lifecycle-mutation-boundary-t2001)、
> [Persistence T2001](../persistence.md#file-lifecycle-checkpoint-extension-t2001) 和
> [EO-008](../engineering-opportunities.md#4-已晋升已完成台账) 分别负责。

## 1. 任务上下文快照

- ID：T2001；执行状态：已完成（docs-only；PR #227 已审阅并合并）。
- 目标：确定文件创建、删除、重命名、单/多文件编辑的不可变计划、精确一次性审批、Diff、
  Checkpoint、原子提交、失败优先级、恢复/兼容规则，并固定显式 RE2-compatible regex 搜索契约。
- 现有前置 owner：Workspace Trust/规范 URI、`propose_file_edit`、Approval、Diff Presenter、
  WorkspaceEdit applier、Checkpoint store 和 literal `search_files`。
- 文档范围：implementation plan、Architecture、Protocol、Security、Persistence、UX、Webview、
  product foundation、PRIVACY 和 engineering-opportunities；不改 runtime/schema 源码。
- 明确不做：T2002–T2005 runtime 实现、依赖/lockfile、目录递归删除、覆盖写、自动回滚、批量
  永久授权、工作区外操作和 regex engine 接入。

## 2. Reuse Audit

- 复用 owner：Builtin Tool 的单文件 plan/输入与 literal search；Core 的
  `TextEditPlan`/排序/重叠校验与 Checkpoint store；Extension 的精确审批生命周期、Diff Presenter、
  WorkspaceEdit/Checkpoint applier；Protocol Checkpoint Schema。
- 决定：新增 Tool 名称只扩展语义边界，不复制既有算法；create/delete/rename 的存在状态与
  file-array 语义保持 distinct operations；regex 仅定义 package-local controlled interface，
  engine 留给 T2005。
- 不复用理由：旧 `propose_file_edit` 不能安全改成文件数组；共享错误沿用 stable mapping，
  不新增仓库级 `utils`。不存在第二份或第三份 T2001 runtime 实现；后续 T2002–T2005 必须
  在实现前重新审计并证明直接复用或深化上述 owner。
- 长期约束：Extension 仍是 Trust、URI、审批、Checkpoint 和原子 WorkspaceEdit 的唯一 Host
  owner；Protocol/Core 继续分别拥有 Schema 与持久化语义；T2005 若采用引擎必须删除被替代
  parser/guard，并由 CtrlZebra-owned adapter 拒绝扩展语法、执行 bounds/cancellation。

## 3. Final Similarity Audit

本任务只增加契约文档中的 additive Tool/DTO 词汇与边界，没有新增 runtime 定义、serializer、
parser、regex/diff/approval 算法、dependency、fake、wrapper 或公共 API。既有
`propose_file_edit`、`TextEditPlan`、`FileEditApprovalWorkflow`、`DiffPresenter`、
`WorkspaceEditApplier`、`AtomicCheckpointStore` 和 `search_files` 仍是唯一语义 owner；
create/delete/rename/workspace-edit 由后续任务实现。Regex 的 product dialect、Checkpoint
state-union compatibility 和 failure precedence 仅在契约正文中固定，未改变当前运行时。

## 4. Build vs Buy 决策快照

- T2001 只定义文件生命周期、Diff/Checkpoint/原子 WorkspaceEdit 与受控 regex dialect，不实现
  通用算法或引擎；现有 VS Code `WorkspaceEdit`、Diff Presenter、Checkpoint store 和 approval
  workflow 继续复用。
- RE2-compatible dialect 固定为线性、non-backtracking、拒绝 backreference/look-around 的
  产品边界；当前不引入依赖。纯 JS `re2js` 仅是 T2005 条件候选，因 lookbehind 扩展不是
  未筛选的 drop-in，必须由受控 adapter 过滤并证明 Unicode、bounds、取消粒度与恶意输入行为。
- 第三方类型/错误不得进入 Protocol/Core；包体、VSIX、编译状态、取消和安全证据属于 T2005
  选择门禁。

## 5. T2001 验证与完成证据

- 本任务为 docs-only：完成文件创建/删除/重命名、单/多文件编辑计划、一次性审批、Diff、
  Checkpoint、原子提交、失败优先级、恢复/兼容及显式 regex 契约的规范更新；未引入 runtime、
  依赖或 Schema 源码。
- 完成证据：[PR #227](https://github.com/yangzuo0621/ctrl-zebra/pull/227)，审阅通过 revision
  `bab91b1b07222c1fd83cea9ed40e7e476d4a9ce7`；required checks、本地 package/smoke 验证、
  `pnpm check` 与 `git diff --check` 均通过。
- 完成日期：2026-08-13。后续执行点为 T2002；T2005 已完成 EO-008 `re2js` fit evaluation
  与受控 regex engine 选型，本记录不替代状态台账。
