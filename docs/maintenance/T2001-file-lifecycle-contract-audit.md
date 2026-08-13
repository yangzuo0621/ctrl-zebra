# T2001 文件生命周期契约审计（历史执行记录）

> 本文件是 T2001 的非权威历史执行记录，不维护任务状态、当前执行点或当前契约。
> 冲突时以 [`implementation-plan.md`](../implementation-plan.md) 的状态台账、[阶段 20 规格](../roadmap/phases/phase-20.md)
> 及其引用的领域文档为准。契约正文仍由 [Protocol T2001](../protocol.md#file-lifecycle-and-atomic-mutation-contracts-t2001)、
> [Architecture T2001](../architecture.md#file-lifecycle-and-atomic-workspaceedit-boundary-t2001)、
> [Security T2001](../security.md#file-lifecycle-mutation-boundary-t2001)、
> [Persistence T2001](../persistence.md#file-lifecycle-checkpoint-extension-t2001) 和
> [EO-008](../engineering-opportunities.md#eo-008-safe-regex-engine) 分别负责。

## 1. 任务上下文快照

- ID：T2001
- 执行时状态：已完成（docs-only 约束；PR #227 已审阅并合并）。
- 目标：确定文件创建、删除、重命名、单文件/多文件编辑的不可变计划、精确一次性审批、Diff、
  Checkpoint、原子提交、失败优先级、恢复/兼容规则，并固定显式 RE2-compatible regex 搜索契约。
- 前置条件：Phase 19 已归档；Workspace Trust、规范 URI、现有 `propose_file_edit`、Approval、
  Diff Presenter、WorkspaceEdit applier 和 Checkpoint store 已存在。
- 计划修改的文件：`docs/implementation-plan.md`、`docs/architecture.md`、`docs/protocol.md`、
  `docs/security.md`、`docs/persistence.md`、`docs/ux.md`、`docs/webview.md`、
  `docs/roadmap/product-foundation.md`、`PRIVACY.md`、`docs/engineering-opportunities.md`。
- 明确不做：T2002–T2005 runtime 实现、Protocol/Schema 源码、Extension/Webview 代码、依赖或
  lockfile、目录递归删除、覆盖写、自动回滚、批量永久授权、工作区外操作、regex engine 接入。

## 2. Reuse Audit

- 计划新增的行为与符号：`propose_file_create`、`propose_file_delete`、`propose_file_rename`、
  `propose_workspace_edit` 的计划/DTO 语义；`search_files.mode: "regex"` 的 dialect/limit/failure
  contract；Checkpoint before/after state union。
- 初始全仓搜索命令、关键词与 engineering-opportunity 记录：
  `rg -n --hidden -S "propose_file_edit|TextEditPlan|WorkspaceEdit|Checkpoint|Approval|Diff|search_files|regex" packages apps docs`；
  审阅 `docs/reviews/REVIEW-2026-08-06.md` K.1–K.3、EO-008、现有 `docs/architecture.md`、
  `docs/security.md`、`docs/persistence.md`。
- 找到的现有实现（路径、符号、语义 owner）：
  `packages/builtin-tools/src/propose-file-edit.ts`（单文件输入/plan，Builtin Tool owner）；
  `packages/core/src/text-edit.ts`（排序/重叠校验，Core owner）；
  `apps/extension/src/controllers/file-edit-approval-workflow.ts`（精确审批/生命周期，Extension controller owner）；
  `apps/extension/src/adapters/diff-presenter.ts`（临时 Diff，Extension owner）；
  `apps/extension/src/adapters/workspace-edit-applier.ts`（写前 revision/Checkpoint/WorkspaceEdit，Extension owner）；
  `packages/protocol/src/checkpoint.ts` 与 `packages/core/src/checkpoint-store.ts`（Checkpoint Schema/store owner）；
  `packages/builtin-tools/src/search-files.ts`（literal search owner）。
- 决定：直接复用既有 single-file edit/approval/Diff/Checkpoint owners；新增 Tool 名称仅扩展语义边界，
  不复制其算法。Regex 通过 package-local controlled interface 评估，T2001 不实现。
- 未复用理由：旧 `propose_file_edit` 的单 `path`/edit 语义不能安全改成文件数组；create/delete/rename
  的存在状态不同，需 distinct public operations；共享错误通过现有 stable mapping，不新增仓库级 `utils`。
- 是否形成第二份或第三份实现：否。T2005 必须删除任何被采用方案取代的 parser/guard；T2002–T2004
  直接调用现有 canonicalization、text-bound、approval、Diff、checkpoint 和 WorkspaceEdit seams。
- 执行中将主动调用或深化的已有功能：`parseTextEdits`/`TextEditPlan`、`FileEditApprovalWorkflow`、
  `WorkspaceEditApplier`、`AtomicCheckpointStore`、`DiffPresenter`、`search_files` truncation。

## 3. Final Similarity Audit

- 复查范围：契约稳定后再次执行全仓搜索（排除 `node_modules`、`dist`、`.artifacts` 和 VS Code
  测试缓存）：
  `rg -n --hidden -S "propose_file_create|propose_file_delete|propose_file_rename|propose_workspace_edit|FileMutationPlanDto|FileMutationTargetDto|FileMutationStateDto|FileMutationDiffDto|FileMutationOutcomeDto|mode: \"regex\"|search_files|TextEditPlan|parseTextEdits|FileEditApprovalWorkflow|WorkspaceEditApplier|DiffPresenter|Checkpoint" .`。
  复查确认本任务提交没有新增 runtime 文件、实现符号或测试 fake。
- 实际符号/行为 inventory、定义计数、owner 与 delta/disposition：

  | 符号或行为 | 全仓 runtime 定义 | 语义 owner / 现有位置 | T2001 disposition |
  |---|---:|---|---|
  | `propose_file_create`, `propose_file_delete`, `propose_file_rename`, `propose_workspace_edit` | 0 | N/A（仅本契约文档） | 仅新增 additive Tool 名称和边界；T2002–T2004 实现，未复制现有 Tool。 |
  | `FileMutationPlanDto`, `FileMutationTargetDto`, `FileMutationStateDto`, `FileMutationDiffDto`, `FileMutationOutcomeDto` | 0 | N/A（仅 Protocol 文档词汇） | 仅定义 transient/persistence 语义；未新增 Schema/type，后续任务负责实现。 |
  | `propose_file_edit` / `createProposeFileEditTool` | 1 creator + 1 name constant in `packages/builtin-tools/src/propose-file-edit.ts` | Builtin Tool owner；输入/单文件 plan 语义保持原样 | 直接复用；没有改名、改输入或新增平行实现。 |
  | `TextEditPlan`, `parseTextEditPlan`, `parseTextEdits` | 1 interface + 1 parser + 1 list parser in `packages/core/src/text-edit.ts` | Core text-edit owner | 后续多文件 Tool 直接复用；本任务未复制排序/重叠算法。 |
  | `FileEditApprovalWorkflow` | 1 class in `apps/extension/src/controllers/file-edit-approval-workflow.ts` | Extension approval lifecycle owner | 复用其 exact approval/consumption seam；未新增 workflow。 |
  | `DiffPresenter` | 1 class in `apps/extension/src/adapters/diff-presenter.ts` | Extension temporary Diff owner | 复用并扩展 contract only；未新增 presenter/patch engine。 |
  | `WorkspaceEditApplier` | 1 class in `apps/extension/src/adapters/workspace-edit-applier.ts` | Extension apply/checkpoint boundary owner | 复用 atomic apply/checkpoint ordering；T2001 未改 runtime。 |
  | `checkpointSchema` / `AtomicCheckpointStore` | 1 schema in `packages/protocol/src/checkpoint.ts` / 1 store class in `packages/core/src/checkpoint-store.ts` | Protocol schema + Core persistence owners | 定义 additive state-union compatibility；未新增 store/serializer。 |
  | `createSearchFilesTool` / `search_files` | 1 creator in `packages/builtin-tools/src/search-files.ts` | Builtin search owner | literal default retained; regex is a bounded contract only, with engine deferred to T2005. |
  | `ToolApprovalOperation`, `ApprovalLifecycle` | 1 interface in `packages/core/src/tool-approval.ts` / 1 class in `apps/extension/src/controllers/approval-lifecycle.ts` | Core operation contract + Extension lifecycle owner | distinguish internal `approved`/`consumed` from public lifecycle `applied`; no second state machine. |

- Similarity delta：新增行为和 DTO 词汇的 runtime 定义数均为零；唯一实际 delta 是十个文档文件中的
  additive contract text。没有删除或替代实现、没有重复 serializer/parser/regex/diff/approval 算法，
  也没有新增 dependency、fake、wrapper 或公共 API 源码。
- 第二/第三实现判定：不存在第二份 T2001 runtime 实现；T2002–T2005 必须在实现前重新搜索并证明
  直接复用或深化上述 owner。若采用 `re2js`，其 adapter 只能由 T2005 在既有 `search_files` owner
  后方受控接入，并须删除被替代的 parser/guard；T2001 不授权该依赖。
- 未复用项及 disposition：旧 `propose_file_edit` 不能承载 create/delete/rename 或文件数组，故保持其
  单文件公共语义并新增名称；原生 JS `RegExp`、未经筛选的 `re2js` LOOKBEHINDS、原生 `re2` addon
  和自建 regex VM 均仅留在 EO-008/T2005 评估，不进入本提交。

## 4. Build vs Buy 决策快照

- 涉及的通用机制：正则引擎（EO-008）、Diff/patch/序列化和原子 WorkspaceEdit；仅定义契约，不在
  T2001 实现通用算法。
- 触发条件：通用正则/复杂度边界和已有 Diff/Checkpoint/WorkspaceEdit 机制；需完成 Build vs Buy
  证据后才能在 T2005/T2004 采用实现。
- 标准库或 VS Code API：VS Code `WorkspaceEdit` 负责 Host-owned atomic submission；原生 JavaScript
  `RegExp` 不满足 ReDoS 安全契约。
- 现有依赖：当前无受控 RE2 engine；现有 text bounds、Diff Presenter、Checkpoint store 和 approval
  workflow reused。
- 官方 SDK 或第三方候选：Google RE2/RE2 syntax（Context7 `/google/re2`）；纯 JS `re2js@2.8.5`
  （MIT, 0 runtime deps, ESM/CJS, built-in types, but README exposes non-RE2 LOOKBEHINDS）；Node native
  `re2`（native addon/VSIX platform burden）。
- 决定：T2001 固定 RE2-compatible product dialect，暂不引入依赖；`re2js` 仅为 T2005 条件候选，必须
  由 CtrlZebra-owned adapter 拒绝 look-around/其他扩展并证明 bounds/cancellation。
- 理由与证据：RE2 Context7 文档确认 linear-time、non-backtracking、拒绝 backreference/look-around；
  npm/GitHub 当前 re2js metadata/README 证明其 pure-JS、MIT、ESM/CJS、线性目标但包含 lookbehind
  extension，因此不是未经筛选的 drop-in。
- 影响：不改变当前 lockfile/VSIX；T2005 需评估包体、Unicode、编译状态、取消粒度和恶意 corpus；
  第三方类型/错误不得进入 Protocol/Core。
- 隔离边界：Builtin Tool/Extension-owned controlled regex interface；第三方 pattern/match/error
  types remain private。

## 5. T2001 验证与完成证据

- 本任务自身验证：docs anchor/contract validation；未引入 runtime 实现、依赖或 Schema 源码。
- 完成摘要：完成文件创建、删除、重命名、单文件/多文件编辑的不可变计划、精确一次性审批、Diff、
  Checkpoint、原子提交、失败优先级、恢复/兼容规则及显式 RE2-compatible regex 搜索契约；本任务仅
  更新规范与约束文档。
- 完成证据：[PR #227](https://github.com/yangzuo0621/ctrl-zebra/pull/227)，审阅通过 revision
  `bab91b1b07222c1fd83cea9ed40e7e476d4a9ce7`；GitHub Actions Ubuntu、macOS、Windows required checks
  均通过；本地 package/smoke 验证、`pnpm check` 与 `git diff --check` 均通过。
- 完成日期：2026-08-13。
- 后续执行点快照：下一任务为 T2002；T2005 负责 EO-008 `re2js` fit evaluation 与受控 regex engine
  选型。此处不替代状态台账。
