# CtrlZebra — VS Code Agent 插件实施计划索引

## 1. 文档目标与读取顺序

本文档是 roadmap 的权威入口，只维护任务顺序、状态、完成证据、当前执行点以及详细规格的位置。完整产品基础和任务正文拆分保存，避免每次执行任务都把全部历史内容载入 AI 上下文。

开始 roadmap 工作时按以下顺序读取：

1. 读取本文档，确认当前任务、状态和对应规格链接。
2. 只读取当前任务所在的活动阶段规格及其中的相邻上下文和阶段门禁。
3. 按任务显式引用读取产品基础或领域文档。
4. 已完成阶段归档仅在回归调查、设计追溯或正式修订历史规格时读取。

## 2. 事实所有权

| 信息 | 唯一权威位置 |
|---|---|
| 任务顺序、状态、完成 PR、完成日期、当前执行点 | 本文档 |
| 活动或计划中任务的目标、产物、测试、排除项、前置条件和阶段门禁 | 对应的 `docs/roadmap/phases/phase-xx.md` |
| 已完成任务的历史规格和阶段门禁 | 对应的 `docs/roadmap/archive/phase-xx.md` |
| 第一阶段产品范围、技术基线、模块边界、接口草案、测试分层和完成定义 | [产品与技术基础规格](roadmap/product-foundation.md) |
| 长期架构、安全、协议和测试规则 | 对应的 `docs/` 领域文档与根 `AGENTS.md` |
| 任务执行报告格式 | [任务执行模板](roadmap/task-template.md) |

任务正文不重复维护状态，领域文档不重复维护任务顺序。发生冲突时，先按上表确定权威位置，再通过变更控制修正文档。

## 3. 范围与技术基础

第一阶段的完整范围和技术基础见 [产品与技术基础规格](roadmap/product-foundation.md)。第一阶段仍仅限桌面 VS Code Extension；扩大产品范围、改变模块边界或技术基线时，必须先更新该规格和本文档。

## 4. 任务执行与状态台账

任务编号是稳定标识。后续实现时一次只领取一个任务，完成验证后再进入下一个。

部分任务包含“开始前约束门禁”。门禁只规定必须在何时建立哪些规则以及规则的最低覆盖范围，不在本文档中提前固化容易过时的实现细节。执行方式如下：

1. 开始实现前检查门禁指定的规范或配置是否已经存在且仍然适用。
2. 如果缺失或不足，先使用当前任务编号创建独立约束 PR：通常是 docs-only；机械规则需要自动执行时可以是 config-only。
3. 独立约束 PR 通过审查并 squash 合入 `main` 后，再从最新 `main` 创建实现分支。
4. 门禁 PR 不代表任务完成；只有实现、测试和任务验收全部通过后，才能标记该任务完成。

### 任务状态管理

本节是全部任务状态的唯一台账。任务正文不重复维护状态，避免同一任务出现两个不同结论。

状态只允许使用以下四个值：

- `待开始`：任务尚未领取，或主干中还没有该任务的完成记录。
- `进行中`：已经从最新 `main` 创建任务分支，正在完成约束门禁、实现或验证。
- `受阻`：任务已经开始，但存在有证据的外部阻塞或需要先批准的设计变更。
- `已完成`：完成定义全部满足，任务 PR 已通过 squash merge 合入 `main`。

状态更新规则：

1. 默认转换为 `待开始 → 进行中 → 已完成`；出现真实阻塞时可以在 `进行中` 与 `受阻` 之间转换。
2. 同一时间最多有一个 `进行中` 任务；约束门禁和实现共享同一个任务状态。
3. 创建任务分支后，先在该分支把任务标记为 `进行中`。主干保存最后一个已合入基线，活动状态以当前任务分支或其 PR 中的本表为准。
4. 任务通过全部验证后，在最终 PR 中将状态改为 `已完成`，填写完成 PR 和完成日期；PR 未合入前，主干中的任务仍不算完成。
5. 约束 PR 不能把任务标记为 `已完成`。如果任务长期受阻且工作分支不会合入，应通过独立状态 PR 将 `受阻` 状态同步到主干。
6. `已完成` 任务只有在发现验收记录错误或实施规格被正式修订时才能重新打开，并必须说明原因。
7. 每次状态变化同时更新下方进度摘要；完成证据使用 GitHub PR 编号或链接，不记录无法在 squash 前确定的最终 commit SHA。

**进度摘要**：

- 总任务：76
- 已完成：76
- 进行中：0
- 受阻：0
- 待开始：0
- 当前任务：无
- 下一任务：无
- 最后更新：2026-07-23

| 阶段 | 任务 | 状态 | 完成 PR | 完成日期 |
|---|---|---|---|---|
| 0 | T0001 | 已完成 | [#4](https://github.com/yangzuo0621/ctrl-zebra/pull/4) | 2026-07-14 |
| 0 | T0002 | 已完成 | [#6](https://github.com/yangzuo0621/ctrl-zebra/pull/6) | 2026-07-14 |
| 0 | T0003 | 已完成 | [#7](https://github.com/yangzuo0621/ctrl-zebra/pull/7) | 2026-07-14 |
| 0 | T0004 | 已完成 | [#9](https://github.com/yangzuo0621/ctrl-zebra/pull/9) | 2026-07-14 |
| 1 | T0101 | 已完成 | [#11](https://github.com/yangzuo0621/ctrl-zebra/pull/11) | 2026-07-14 |
| 1 | T0102 | 已完成 | [#12](https://github.com/yangzuo0621/ctrl-zebra/pull/12) | 2026-07-15 |
| 1 | T0103 | 已完成 | [#13](https://github.com/yangzuo0621/ctrl-zebra/pull/13) | 2026-07-15 |
| 1 | T0104 | 已完成 | [#14](https://github.com/yangzuo0621/ctrl-zebra/pull/14) | 2026-07-15 |
| 1 | T0105 | 已完成 | [#15](https://github.com/yangzuo0621/ctrl-zebra/pull/15) | 2026-07-15 |
| 2 | T0201 | 已完成 | [#16](https://github.com/yangzuo0621/ctrl-zebra/pull/16) | 2026-07-15 |
| 2 | T0202 | 已完成 | [#17](https://github.com/yangzuo0621/ctrl-zebra/pull/17) | 2026-07-15 |
| 2 | T0203 | 已完成 | [#18](https://github.com/yangzuo0621/ctrl-zebra/pull/18) | 2026-07-15 |
| 2 | T0204 | 已完成 | [#19](https://github.com/yangzuo0621/ctrl-zebra/pull/19) | 2026-07-15 |
| 2 | T0205 | 已完成 | [#20](https://github.com/yangzuo0621/ctrl-zebra/pull/20) | 2026-07-15 |
| 3 | T0301 | 已完成 | [#22](https://github.com/yangzuo0621/ctrl-zebra/pull/22) | 2026-07-15 |
| 3 | T0302 | 已完成 | [#23](https://github.com/yangzuo0621/ctrl-zebra/pull/23) | 2026-07-16 |
| 3 | T0303 | 已完成 | [#24](https://github.com/yangzuo0621/ctrl-zebra/pull/24) | 2026-07-16 |
| 3 | T0304 | 已完成 | [#25](https://github.com/yangzuo0621/ctrl-zebra/pull/25) | 2026-07-16 |
| 3 | T0305 | 已完成 | [#26](https://github.com/yangzuo0621/ctrl-zebra/pull/26) | 2026-07-16 |
| 3 | T0306 | 已完成 | [#28](https://github.com/yangzuo0621/ctrl-zebra/pull/28) | 2026-07-16 |
| 3 | T0307 | 已完成 | [#30](https://github.com/yangzuo0621/ctrl-zebra/pull/30) | 2026-07-17 |
| 3 | T0308 | 已完成 | [#31](https://github.com/yangzuo0621/ctrl-zebra/pull/31) | 2026-07-17 |
| 3 | T0309 | 已完成 | [#32](https://github.com/yangzuo0621/ctrl-zebra/pull/32) | 2026-07-17 |
| 3 | T0310 | 已完成 | [#35](https://github.com/yangzuo0621/ctrl-zebra/pull/35) | 2026-07-17 |
| 4 | T0401 | 已完成 | [#39](https://github.com/yangzuo0621/ctrl-zebra/pull/39) | 2026-07-17 |
| 4 | T0402 | 已完成 | [#40](https://github.com/yangzuo0621/ctrl-zebra/pull/40) | 2026-07-17 |
| 4 | T0403 | 已完成 | [#41](https://github.com/yangzuo0621/ctrl-zebra/pull/41) | 2026-07-17 |
| 4 | T0404 | 已完成 | [#42](https://github.com/yangzuo0621/ctrl-zebra/pull/42) | 2026-07-17 |
| 4 | T0405 | 已完成 | [#43](https://github.com/yangzuo0621/ctrl-zebra/pull/43) | 2026-07-17 |
| 4 | T0406 | 已完成 | [#44](https://github.com/yangzuo0621/ctrl-zebra/pull/44) | 2026-07-17 |
| 4 | T0407 | 已完成 | [#45](https://github.com/yangzuo0621/ctrl-zebra/pull/45) | 2026-07-17 |
| 4 | T0408 | 已完成 | [#46](https://github.com/yangzuo0621/ctrl-zebra/pull/46) | 2026-07-17 |
| 4 | T0409 | 已完成 | [#47](https://github.com/yangzuo0621/ctrl-zebra/pull/47) | 2026-07-17 |
| 4 | T0410 | 已完成 | [#48](https://github.com/yangzuo0621/ctrl-zebra/pull/48) | 2026-07-17 |
| 4 | T0411 | 已完成 | [#50](https://github.com/yangzuo0621/ctrl-zebra/pull/50) | 2026-07-18 |
| 5 | T0501 | 已完成 | [#53](https://github.com/yangzuo0621/ctrl-zebra/pull/53) | 2026-07-19 |
| 5 | T0502 | 已完成 | [#54](https://github.com/yangzuo0621/ctrl-zebra/pull/54) | 2026-07-19 |
| 5 | T0503 | 已完成 | [#55](https://github.com/yangzuo0621/ctrl-zebra/pull/55) | 2026-07-19 |
| 5 | T0504 | 已完成 | [#56](https://github.com/yangzuo0621/ctrl-zebra/pull/56) | 2026-07-19 |
| 5 | T0505 | 已完成 | [#57](https://github.com/yangzuo0621/ctrl-zebra/pull/57) | 2026-07-19 |
| 5 | T0506 | 已完成 | [#58](https://github.com/yangzuo0621/ctrl-zebra/pull/58) | 2026-07-19 |
| 5 | T0507 | 已完成 | [#59](https://github.com/yangzuo0621/ctrl-zebra/pull/59) | 2026-07-19 |
| 5 | T0508 | 已完成 | [#60](https://github.com/yangzuo0621/ctrl-zebra/pull/60) | 2026-07-19 |
| 5 | T0509 | 已完成 | [#61](https://github.com/yangzuo0621/ctrl-zebra/pull/61) | 2026-07-19 |
| 6 | T0601 | 已完成 | [#63](https://github.com/yangzuo0621/ctrl-zebra/pull/63) | 2026-07-19 |
| 6 | T0602 | 已完成 | [#64](https://github.com/yangzuo0621/ctrl-zebra/pull/64) | 2026-07-19 |
| 6 | T0603 | 已完成 | [#65](https://github.com/yangzuo0621/ctrl-zebra/pull/65) | 2026-07-19 |
| 6 | T0604 | 已完成 | [#66](https://github.com/yangzuo0621/ctrl-zebra/pull/66) | 2026-07-19 |
| 6 | T0605 | 已完成 | [#67](https://github.com/yangzuo0621/ctrl-zebra/pull/67) | 2026-07-19 |
| 6 | T0606 | 已完成 | [#68](https://github.com/yangzuo0621/ctrl-zebra/pull/68) | 2026-07-19 |
| 6 | T0607 | 已完成 | [#69](https://github.com/yangzuo0621/ctrl-zebra/pull/69) | 2026-07-19 |
| 7 | T0701 | 已完成 | [#71](https://github.com/yangzuo0621/ctrl-zebra/pull/71) | 2026-07-19 |
| 7 | T0702 | 已完成 | [#72](https://github.com/yangzuo0621/ctrl-zebra/pull/72) | 2026-07-19 |
| 7 | T0703 | 已完成 | [#73](https://github.com/yangzuo0621/ctrl-zebra/pull/73) | 2026-07-19 |
| 7 | T0704 | 已完成 | [#74](https://github.com/yangzuo0621/ctrl-zebra/pull/74) | 2026-07-19 |
| 7 | T0705 | 已完成 | [#75](https://github.com/yangzuo0621/ctrl-zebra/pull/75) | 2026-07-19 |
| 7 | T0706 | 已完成 | [#76](https://github.com/yangzuo0621/ctrl-zebra/pull/76) | 2026-07-19 |
| 7 | T0707 | 已完成 | [#77](https://github.com/yangzuo0621/ctrl-zebra/pull/77) | 2026-07-19 |
| 8 | T0801 | 已完成 | [#79](https://github.com/yangzuo0621/ctrl-zebra/pull/79) | 2026-07-19 |
| 8 | T0802 | 已完成 | [#80](https://github.com/yangzuo0621/ctrl-zebra/pull/80) | 2026-07-19 |
| 8 | T0803 | 已完成 | [#81](https://github.com/yangzuo0621/ctrl-zebra/pull/81) | 2026-07-19 |
| 8 | T0804 | 已完成 | [#82](https://github.com/yangzuo0621/ctrl-zebra/pull/82) | 2026-07-19 |
| 9 | T0901 | 已完成 | [#84](https://github.com/yangzuo0621/ctrl-zebra/pull/84) | 2026-07-19 |
| 9 | T0902 | 已完成 | [#85](https://github.com/yangzuo0621/ctrl-zebra/pull/85) | 2026-07-19 |
| 9 | T0903 | 已完成 | [#86](https://github.com/yangzuo0621/ctrl-zebra/pull/86) | 2026-07-19 |
| 9 | T0904 | 已完成 | [#87](https://github.com/yangzuo0621/ctrl-zebra/pull/87) | 2026-07-19 |
| 9 | T0905 | 已完成 | [#88](https://github.com/yangzuo0621/ctrl-zebra/pull/88) | 2026-07-22 |
| 9 | T0906 | 已完成 | [#89](https://github.com/yangzuo0621/ctrl-zebra/pull/89) | 2026-07-22 |
| 10 | T1001 | 已完成 | [#91](https://github.com/yangzuo0621/ctrl-zebra/pull/91) | 2026-07-22 |
| 10 | T1002 | 已完成 | [#92](https://github.com/yangzuo0621/ctrl-zebra/pull/92) | 2026-07-22 |
| 10 | T1003 | 已完成 | [#93](https://github.com/yangzuo0621/ctrl-zebra/pull/93) | 2026-07-22 |
| 10 | T1004 | 已完成 | [#95](https://github.com/yangzuo0621/ctrl-zebra/pull/95) | 2026-07-22 |
| 10 | T1005 | 已完成 | [#96](https://github.com/yangzuo0621/ctrl-zebra/pull/96) | 2026-07-22 |
| 10 | T1006 | 已完成 | [#104](https://github.com/yangzuo0621/ctrl-zebra/pull/104) | 2026-07-23 |
| 10 | T1007 | 已完成 | [#105](https://github.com/yangzuo0621/ctrl-zebra/pull/105) | 2026-07-23 |
| 10 | T1008 | 已完成 | [#106](https://github.com/yangzuo0621/ctrl-zebra/pull/106) | 2026-07-23 |

---

## 5. 阶段规格索引

阶段 0–10 已完成，完整任务正文按阶段归档。未来新增阶段时，在 `docs/roadmap/phases/` 创建一个阶段规格文件，并在任务台账加入任务后再开始实现。

| 阶段 | 状态 | 详细规格 |
|---|---|---|
| 0 | 已完成 | [阶段 0 归档](roadmap/archive/phase-00.md) |
| 1 | 已完成 | [阶段 1 归档](roadmap/archive/phase-01.md) |
| 2 | 已完成 | [阶段 2 归档](roadmap/archive/phase-02.md) |
| 3 | 已完成 | [阶段 3 归档](roadmap/archive/phase-03.md) |
| 4 | 已完成 | [阶段 4 归档](roadmap/archive/phase-04.md) |
| 5 | 已完成 | [阶段 5 归档](roadmap/archive/phase-05.md) |
| 6 | 已完成 | [阶段 6 归档](roadmap/archive/phase-06.md) |
| 7 | 已完成 | [阶段 7 归档](roadmap/archive/phase-07.md) |
| 8 | 已完成 | [阶段 8 归档](roadmap/archive/phase-08.md) |
| 9 | 已完成 | [阶段 9 归档](roadmap/archive/phase-09.md) |
| 10 | 已完成 | [阶段 10 归档](roadmap/archive/phase-10.md) |

## 6. 后续能力候选顺序

第一版发布后，建议按以下顺序评估：

1. 更多专用模型供应商，继续验证 Provider 边界。
2. Plan/Act 模式，验证 Tool Policy 可配置性。
3. 项目级规则文件。
4. MCP Client。
5. Git 状态感知和提交辅助。
6. 代码语义索引。
7. 多 Agent。

多 Agent 必须建立在可恢复 Session、确定性 Tool 生命周期和资源隔离之上。

## 7. 任务执行模板

开始和完成任务时使用 [任务执行模板](roadmap/task-template.md)。

## 8. 变更控制

如果实施中需要改变模块边界、技术基线或任务顺序：

1. 先说明当前任务遇到的具体证据。
2. 写出至少一个替代方案和影响。
3. 更新本文档，再修改代码。
4. 不以“顺手重构”为理由扩大当前任务范围。

新增需求默认进入后续候选清单，不直接插入正在执行的最小任务。

## 9. 当前执行点

阶段 0–10 的 76 个任务均已完成，目前没有活动任务或下一任务。开始新的 roadmap 工作前，先按变更控制增加阶段规格和任务台账记录。
