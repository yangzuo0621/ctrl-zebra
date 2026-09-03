# 阶段 23：架构收敛与可维护性治理

> **归档状态：阶段完成（本 PR）**
>
> - 归档日期：2026-09-03
> - 完成任务：T2301–T2306；任务已通过 [PR #276](https://github.com/yangzuo0621/ctrl-zebra/pull/276)、[PR #278](https://github.com/yangzuo0621/ctrl-zebra/pull/278)、[PR #280](https://github.com/yangzuo0621/ctrl-zebra/pull/280)、[PR #281](https://github.com/yangzuo0621/ctrl-zebra/pull/281)、[PR #284](https://github.com/yangzuo0621/ctrl-zebra/pull/284) 和本 PR [#283](https://github.com/yangzuo0621/ctrl-zebra/pull/283) 完成。
> - 阶段门禁：本 PR 已完成阶段规格要求；合并后阶段状态在 `main` 生效。

## 1. 阶段目标

在阶段 22 完成 Preview / GA 工程就绪后，暂停新增 capability，针对随着功能增长已经显现的维护成本进行一次受控的架构收敛。

本阶段的目标不是追求更少的总代码行数，也不是重写现有系统，而是：

- 降低大型协调器、组合根、测试文件和热文档的职责密度；
- 只对有具体重复、耦合或 ownership 证据的问题进行收敛；
- 收紧既有 package 边界和依赖方向，减少功能继续增长时的跨层扩散；
- 建立文档 Single Source of Truth，减少同一事实在多个位置重复维护；
- 降低新增同类能力的 change surface，使常规扩展尽量落在已有 owner 和稳定扩展点；
- 把本阶段验证出的领域边界和治理经验作为未来独立 Desktop Runtime 的设计输入，但不在本阶段实现 Desktop、独立 Runtime 或语言重写。

本阶段不以“大拆包”“全仓库重写”“统一所有抽象”为目标。所有重构必须由当前主干中的可验证证据驱动，并保持现有产品范围、用户行为、安全语义、公开契约和持久化兼容。

## 2. 前置条件与范围

- 阶段 0–22 已完成。
- 当前产品范围继续严格保持为 `docs/roadmap/product-foundation.md` 定义的桌面 VS Code Extension。
- 保持根 `AGENTS.md` 中的现有 package 依赖方向和领域所有权，除非某任务获得明确的变更控制授权。
- 保持 Workspace confinement、exact / expiring / single-use approval、无 shell 命令执行、Checkpoint 冲突保护、MCP 独立安全边界、取消与资源上限等现有安全不变量。
- 保持公开 Protocol DTO、Provider 行为、Session / Checkpoint 可观察语义和用户交互兼容，除非任务证据证明必须改变且已先更新权威规格。
- 优先深化已有 owner；不得为了减小文件或制造“统一架构”而新增无独立语义的 helper、manager、wrapper、facade 或泛型层。
- 已完成的 `EO-001`–`EO-008` maintenance 默认视为既有收敛结果，不重新执行；只有发现明确 regression evidence 时才允许在对应任务中重新评估。
- 不以 LOC 下降作为完成标准。若为明确边界增加少量结构代码，只要重复、耦合或 change surface 得到实质改善即可接受。

本阶段明确排除：

- 新 Provider、新 Tool、新 MCP transport、新协议版本支持；
- Plan/Act、Skills、跨会话记忆、多 Agent、多模态、运行中插话等后续能力；
- 将 Core 重写为 Rust / Go；
- 将 Extension 拆成独立 daemon；
- 新建独立 Desktop App；
- 产品范围、信任模型或安全授权模型的重新设计；
- 为“未来可能复用”提前引入未被当前问题证明必要的基础设施；
- 对已完成 maintenance 进行无证据的重复重构。

## 3. 执行原则

1. 一次只执行一个 T23xx 任务，完成验证后再进入下一个。
2. T2301 必须先完成，为后续任务建立事实基线和收敛门禁；不得在基线任务中顺手重构。
3. 测试行为分区优先于生产代码大拆分：先使回归边界可见，再迁移职责。
4. 抽象只允许消除已证明存在的重复机制或不清晰 ownership；相似代码、文件较大或命名接近都不自动构成抽象理由。
5. 优先直接复用或深化已有 owner。新增共享抽象前必须满足 `docs/development.md#reuse-before-build` 的适用审计要求。
6. 文档治理遵循“一个事实一个 owner”；非 owner 文档只保留稳定链接、导航或必要短摘要。
7. 机械检查只保护可确定判断的架构不变量；文件大小、similarity 和 change surface 默认作为 review signal，不作为无条件 CI hard gate。
8. 每个任务必须说明行为保持证据、受影响 owner、实际减少的重复/职责/change surface，以及未处理但发现的机会；后者进入 `docs/engineering-opportunities.md`，不得顺手扩大范围。

## 4. 任务

### T2301：建立可维护性热点基线与收敛门禁

**目标**

对当前主干进行一次有界、只读的 maintainability hotspot 审计，建立后续收敛任务的事实基线，避免依据文件大小、主观风格或已经完成的 maintenance 重复规划工作。

**产物**

- 记录 production、test 和文档中的主要热点，优先覆盖：
  - 大型生产文件及其实际职责；
  - 大型测试文件及其行为覆盖分布；
  - 高频变更或组合职责集中的 Host / Core 入口；
  - 大型或多 owner 风险较高的热文档；
- 生成当前 package dependency map，并核对其与根 `AGENTS.md` 和 public package entry points 的一致性；
- 对候选重复进行 targeted evidence 收集，只记录有两个以上真实实现或重复状态机/生命周期的机制；
- 交叉检查 `docs/engineering-opportunities.md` 与 `docs/maintenance/`，避免重新规划已经完成或已明确暂缓的机会；
- 为 T2302–T2306 给出每项的具体证据、候选文件/owner、预期收益和明确排除项；
- 记录后续重构必须保持的行为、安全、协议、持久化、资源和取消不变量；
- 记录当前 change-surface 基线：选取少量近期已完成的代表性 feature / maintenance，统计其实际触及的 package / owner，用于 T2306 结束时做方向性比较。

基线报告放入 `docs/maintenance/`，作为本阶段审计快照；它不成为新的长期架构事实 owner。

**测试 / 验证**

- dependency map 与 workspace manifests、实际 imports、package exports 和根 `AGENTS.md` 一致；
- 所有重构候选必须包含具体 file / symbol / owner 证据；
- 对 `EO-001`–`EO-008` 只做 regression check，不重新执行完整审计；
- 不修改 production behavior、Protocol、配置、持久化格式、安全语义或用户行为；
- `git diff --check`，并确认本任务仅包含基线与必要 roadmap / maintenance 文档。

**排除项**

- 不拆文件；
- 不新增抽象；
- 不修复发现的问题；
- 不调整现有 package 边界；
- 不做无边界的 repository-wide similarity 清扫。

---

### T2302：收敛文档 Hot Context 与 Single Source of Truth

**目标**

基于 T2301 的文档热点和事实所有权证据，降低热文档读取成本和重复维护风险，同时保留当前已经有效的 progressive document loading 结构。

**产物**

- 保持现有文档 ownership 原则：
  - `README.md`：用户安装、配置、使用与公开行为入口；
  - `AGENTS.md`：仓库级不变量与文档路由；
  - `docs/implementation-plan.md`：任务顺序、状态与活动规格索引；
  - `docs/roadmap/phases/`：活动 / 计划阶段规格；
  - `docs/architecture.md`、`docs/protocol.md`：领域导航入口；
  - `docs/architecture/`、`docs/protocol/` 及其他 domain docs：各自长期事实 owner；
- 将当前已经是轻量 router 的 `architecture.md`、`protocol.md` 作为基线，不为形式一致性重复拆分；
- 对 T2301 确认的 hot documents 评估是否存在稳定子领域；只有边界稳定且能降低常规读取成本时才拆成 router + shards；
- 优先审查 persistence、configuration、development 以及其他被基线确认的大型热文档；
- 将非 owner 文档中的完整重复规范改为稳定链接或必要短摘要；
- 删除已失效且无历史价值的重复段落；历史决策保留在 ADR 或 archive，不重新抄回热文档；
- 保持根 `AGENTS.md`、implementation plan 和普通任务默认读取集尽量小。

**测试 / 验证**

- 检查所有修改后的相对链接和 heading anchor；
- 对关键安全、协议、持久化和 roadmap 事实做针对性搜索，确认没有冲突的第二 owner；
- 常规任务的文档读取路径不得比重构前更宽；
- 不改变任何产品、安全、协议、持久化或用户行为语义；
- `pnpm test:docs` 和其他受影响文档检查通过。

**排除项**

- 不为了减少单文件长度机械拆文档；
- 不重写已完成阶段 archive；
- 不将 task execution / review evidence 写入 roadmap 热索引；
- 不把已经合理的 architecture / protocol router 重新设计一遍。

---

### T2303：拆分 Agent Runtime 大型测试并建立行为分区

**目标**

在修改 `AgentRuntime` 生产结构前，将当前大型 runtime 测试按稳定行为边界拆分，使后续重构能够使用更窄、更可定位的回归验证。

**产物**

将现有 Agent Runtime 测试按当前真实行为边界拆分为 focused suites。具体文件名和数量由 T2301 / 当前测试内容决定，可评估：

- Session / Run lifecycle 与状态转换；
- model stream / finish / malformed output；
- Tool loop 与 Tool Call / Tool Result 顺序；
- approval；
- cancellation / abort；
- context construction / pruning / overflow recovery；
- token / Run budget；
- persistence / recovery 相关 contract；
- Provider failure / retry-adjacent runtime behavior。

允许提取稳定、无领域歧义的 package-private test fixture / builder，但不得建立新的 mega helper、跨 package test utility 或隐藏安全关键前置条件。

**测试 / 验证**

- 拆分前后测试语义和覆盖目标等价；
- 不删除仅因“看起来重复”而存在的边界 / 回归用例；
- focused suites 可独立运行；
- package 与 repository 要求的 unit tests、coverage、typecheck 和 lint 继续通过；
- production code 除必要且有证据的 test seam 外保持不变；新增 seam 不扩大 public API。

**排除项**

- 不在本任务拆 `agent-runtime.ts`；
- 不改变 Tool / approval / Session contract；
- 不修改 runtime 行为以让测试“更好写”；
- 不把仅 Core 使用的 fixture 搬入 `packages/testkit`。

---

### T2304：按已证明职责收敛 AgentRuntime

**目标**

基于 T2301 的职责热点和 T2303 的行为分区，降低 `AgentRuntime` 内部 orchestration 密度，使主运行循环更容易理解和验证，同时避免为拆文件预设新的 Coordinator 层级。

**产物**

- 识别 `AgentRuntime` 内已经形成独立 invariant、算法或生命周期的 cohesive clusters；
- 优先深化现有 owner；只有现有模块无法自然拥有该职责且重复/复杂度证据充分时才新增 package-private deep module；
- 保持 `AgentRuntime` 作为 Core 的运行时编排入口，主流程能够清晰表达：
  1. 建立 / 获取 Session 与 Run ownership；
  2. 加载和准备 model context；
  3. 驱动 model stream；
  4. 处理 Tool Call / Result 循环；
  5. 传播 cancellation / budget / terminal outcome；
- 将不应由 orchestration 入口长期承载的复杂 mechanics 迁移到明确 owner，但不得只增加 forwarding wrapper；
- 保留现有事件顺序、Tool Call / Tool Result 配对、reasoning projection、budget、history pruning、overflow recovery 和 terminal-state priority。

**测试 / 验证**

- T2303 focused suites 全部通过；
- Session 状态转换、取消优先级、Tool Call / Tool Result 配对、context trimming、overflow recovery、Run budget 和 Provider 可观察结果与重构前一致；
- `packages/core` 继续 host- / vendor-independent；
- 不产生新的 cross-package cycle、deep import 或 VS Code / Provider SDK 依赖；
- 新增模块必须通过 Reuse Before Build，并证明拥有独立语义而非只转发原方法；
- 对重构前后主要 runtime responsibility map 做对照，说明哪些职责被真正迁移、哪些仍由 `AgentRuntime` 拥有及原因。

**排除项**

- 不改变公开 Protocol；
- 不引入独立进程；
- 不引入 DI container、通用 event-sourcing framework 或新的 package；
- 不预设 `TurnCoordinator`、`ToolCoordinator`、`ContextCoordinator` 等类名或层级；
- 不以固定 LOC 目标作为验收条件。

---

### T2305：收敛 Extension Composition Root 与 Feature Wiring

**目标**

审查并收敛 `apps/extension` 的 composition root 和 feature wiring，使 `extension.ts` 保持“注册 + 依赖装配”的 Host 入口，而不是随着功能增长成为第二个业务工作流 owner。

**产物**

- 基于 T2301 识别 `extension.ts` 中：
  - 正常且应保留的 composition；
  - 重复的 feature wiring；
  - 已形成独立生命周期/ownership 的初始化组；
  - 实际承担业务决策、状态机或复杂错误映射的 closure / inline flow；
- 将有明确 owner 的 feature wiring 收敛到已有 controller / adapter / feature-local composition helper；
- 保持 `activate()` cheap、deterministic、lazy，继续遵守 `docs/architecture/lifecycle.md`；
- 保持 Extension 是 VS Code API、Host lifecycle、URI conversion、SecretStorage、process ownership 和 composition 的唯一 owner；
- 不把业务逻辑下沉到 Webview，也不把 VS Code 类型上推到 Core / Protocol；
- 对长生命周期资源保持唯一 owner、幂等 cleanup 和显式 ownership transfer。

**测试 / 验证**

- Extension activation、Webview first-use、Provider selection、workspace Tool registry、approval routing、MCP connection、Session recovery 和 diagnostics 等受影响 smoke / integration paths 保持行为一致；
- activation 不新增 workspace scan、network、model initialization 或隐式 Session restore；
- disposal / cancellation / child-process cleanup 继续通过现有 lifecycle tests；
- `extension.ts` 减少的是实际 feature ownership / repeated wiring，而不是通过无行为 wrapper 隐藏原代码；
- 不产生新的 cross-package dependency 或 public export。

**排除项**

- 不要求 `extension.ts` 降到固定行数；
- 不拆独立 daemon；
- 不引入新的 application framework；
- 不把每组几行 wiring 都机械提取成文件；
- 不改变 VS Code 命令、设置、产品 UI 或 activation contract。

---

### T2306：建立 Architecture Fitness Checks 并验证收敛结果

**目标**

把本阶段已经确认的关键边界转化为稳定、低噪声、可重复的维护检查，并用 T2301 基线验证本阶段是否真正降低了结构性维护成本。

**产物**

在现有 CI / maintenance 体系内增加或完善以下检查；只有可确定、低噪声、可操作的规则作为 hard gate：

**Hard gates 候选**

- package dependency direction；
- dependency cycle；
- 禁止未授权 deep cross-package imports；
- `packages/core` 禁止依赖 VS Code、Node Host API 或 Provider SDK；
- Webview 禁止直接依赖 core / providers / builtin-tools / mcp-client；
- Provider / MCP SDK 类型不得越过既有 package public boundary；
- roadmap 活动规格、implementation plan 状态 owner 和关键文档路由的机械一致性。

**Advisory signals 候选**

- production / test / document hotspot；
- 文件职责异常增长；
- similarity / duplication report；
- representative change surface；
- 本阶段收敛后重新出现已删除旧路径的 regression signal。

软预算和 advisory threshold 必须基于 T2301 的真实分布，不以任意 LOC 数值替代职责判断。

同时生成一次 Phase 23 completion comparison：

- 对照 T2301 hotspots；
- 对照代表性 change-surface baseline；
- 说明哪些热点已下降、哪些保持合理、哪些转入 `engineering-opportunities.md`；
- 不为满足指标继续追加重构。

**测试 / 验证**

- 每个 hard rule 提供 deterministic 正例 / 负例；
- warning 不因平台、生成文件、fixture 或合法 package-local pattern 产生高噪声；
- CI 失败指出具体 package / import / owner 和修复方向；
- 不通过降低功能、跳过安全检查或隐藏生成物来满足预算；
- 文档说明哪些规则是 hard gate、哪些是 advisory；
- Phase 23 comparison 只做方向性证据，不把 change-surface 或 LOC 变成产品 KPI。

**排除项**

- 不引入大型静态分析平台，除非现有工具无法满足且 Build-vs-Buy 门禁批准；
- 不把 similarity、文件大小或 change surface 直接设为 CI hard fail；
- 不新增产品 telemetry；
- 不为“让指标更好看”继续扩大 Phase 23 范围。

## 5. 任务顺序与依赖

默认顺序：

```text
T2301
  ↓
T2302
  ↓
T2303
  ↓
T2304
  ↓
T2305
  ↓
T2306
```

约束：

- T2301 必须最先完成。
- T2302 只处理 T2301 确认的文档热点和 ownership 问题。
- T2303 在任何 AgentRuntime production 重构前完成。
- T2304 不得与 T2303 合并为一个大任务。
- T2305 基于 T2301 的 Extension hotspot 证据独立实施，不与 Core runtime 重构混在同一 PR。
- T2306 最后执行，hard gate 与 advisory threshold 基于本阶段收敛后的真实结构。

## 6. 阶段门禁

阶段 23 完成时必须满足：

- 根 `AGENTS.md` 的 package dependency direction 继续成立，或任何获准变更已经先完成 change control 和 owner 文档更新；
- `AgentRuntime` 的主循环以 orchestration 为主，不再承载 T2301 已确认可由明确 owner 深化的复杂 mechanics；
- 大型 Agent Runtime 测试已按行为边界拆分，focused suites 能独立定位主要回归；
- `extension.ts` 继续作为 composition root，T2301 确认的业务 ownership / repeated wiring 不再留在该入口；
- roadmap、architecture、security、protocol、persistence 和用户文档的长期事实拥有清晰 canonical owner，无已知冲突的完整重复规范；
- 已完成的 EO / maintenance 没有被 Phase 23 重复抽象或重新实现；
- architecture fitness checks 能检测关键依赖方向和至少一类高价值架构回退，失败 / warning 可操作；
- 对照 T2301，主要 hotspot、职责密度或代表性 change surface 至少有明确改善证据；没有改善的候选有清晰的保留理由或被移入工程机会台账；
- 产品范围、公开行为、授权模型、持久化兼容和受支持 MCP / Provider 范围没有未经批准的变化；
- 全部受影响测试、typecheck、lint、repository checks 和要求的 smoke / performance regression checks 通过。

## 7. 完成判据与评估方式

本阶段不以“代码总量减少”或“文件全部低于某行数”作为完成判据。

优先评估以下结果：

1. **职责密度下降**：大型协调器、组合根、测试文件和热文档更接近单一清晰 owner。
2. **重复机制下降**：只对有真实证据的重复 lifecycle / wiring / ownership 进行收敛，不重复已有 maintenance。
3. **Change surface 下降或稳定**：新增同类 capability 时已有稳定扩展点可承载变化，或代表性改动触及的 owner 数减少。
4. **Owner 清晰度提升**：代码、协议、文档和安全规则能够找到单一权威位置。
5. **回归可检测**：关键 package / boundary invariant 由 deterministic fitness checks 或 focused tests 保护。
6. **行为保持**：用户可观察行为和安全属性没有因为重构而弱化。
7. **抽象数量受控**：不存在仅用于转发、隐藏 LOC 或统一命名而新增的 abstraction layer。

若某项重构增加了结构代码但显著降低上述维护成本，可以接受；若只是移动代码、增加 wrapper 或把重复隐藏在更复杂的泛型中，则不视为完成。

## 8. 变更控制

任何任务如果发现必须改变以下内容，应停止当前实现并先更新权威规格：

- package / module boundary；
- public Protocol 或 package contract；
- Session / Checkpoint persisted format；
- approval / workspace / MCP security model；
- 产品范围或 VS Code 技术基线；
- Phase 23 任务顺序、验收标准或排除项。

发现超出本阶段范围的可维护性机会，记录到 `docs/engineering-opportunities.md`；不得以“架构收敛”为理由顺手实施。
