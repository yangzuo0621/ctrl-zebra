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
| 当前授权产品范围、技术基线、模块边界、跨模块契约地图、产品级验证要求和完成定义 | [产品与技术基础规格](roadmap/product-foundation.md) |
| 长期架构、安全、协议和测试规则 | 对应的 `docs/` 领域文档与根 `AGENTS.md` |
| 用户路径、信息架构、交互反馈、视觉层级和体验验收 | [用户体验规范](ux.md) |
| 任务执行报告格式 | [任务执行模板](roadmap/task-template.md) |
| 尚未获准的复用、模块深化、依赖引入和重复消除候选及其评估处置 | [工程机会台账](engineering-opportunities.md) |

任务正文不重复维护状态，领域文档不重复维护任务顺序。发生冲突时，先按上表确定权威位置，再通过变更控制修正文档。

## 3. 范围与技术基础

当前获准范围和技术基础见 [产品与技术基础规格](roadmap/product-foundation.md)。产品仍仅限该规格明确
授权的桌面 VS Code Extension；扩大产品范围、改变模块边界或技术基线时，必须先更新该规格和本文档。

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

- 总任务：148
- 已完成：130
- 进行中：0
- 受阻：0
- 待开始：18
- 当前执行：T2002（T2001 约束 PR 合入后）
- 下一任务：T2003
- 最后更新：2026-08-13

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
| 11 | T1101 | 已完成 | [#114](https://github.com/yangzuo0621/ctrl-zebra/pull/114) | 2026-07-27 |
| 11 | T1102 | 已完成 | [#115](https://github.com/yangzuo0621/ctrl-zebra/pull/115) | 2026-07-27 |
| 11 | T1103 | 已完成 | [#116](https://github.com/yangzuo0621/ctrl-zebra/pull/116) | 2026-07-27 |
| 11 | T1104 | 已完成 | [#117](https://github.com/yangzuo0621/ctrl-zebra/pull/117) | 2026-07-27 |
| 11 | T1105 | 已完成 | [#118](https://github.com/yangzuo0621/ctrl-zebra/pull/118) | 2026-07-27 |
| 11 | T1106 | 已完成 | [#119](https://github.com/yangzuo0621/ctrl-zebra/pull/119) | 2026-07-27 |
| 11 | T1107 | 已完成 | [#120](https://github.com/yangzuo0621/ctrl-zebra/pull/120) | 2026-07-27 |
| 11 | T1108 | 已完成 | [#121](https://github.com/yangzuo0621/ctrl-zebra/pull/121) | 2026-07-27 |
| 12 | T1201 | 已完成 | [#129](https://github.com/yangzuo0621/ctrl-zebra/pull/129) | 2026-07-29 |
| 13 | T1301 | 已完成 | [#131](https://github.com/yangzuo0621/ctrl-zebra/pull/131) | 2026-07-31 |
| 13 | T1302 | 已完成 | [#132](https://github.com/yangzuo0621/ctrl-zebra/pull/132) | 2026-07-31 |
| 13 | T1303 | 已完成 | [#133](https://github.com/yangzuo0621/ctrl-zebra/pull/133) | 2026-07-31 |
| 13 | T1304 | 已完成 | [#135](https://github.com/yangzuo0621/ctrl-zebra/pull/135) | 2026-07-31 |
| 14 | T1401 | 已完成 | [#141](https://github.com/yangzuo0621/ctrl-zebra/pull/141) | 2026-08-03 |
| 14 | T1402 | 已完成 | [#143](https://github.com/yangzuo0621/ctrl-zebra/pull/143) | 2026-08-03 |
| 14 | T1403 | 已完成 | [#144](https://github.com/yangzuo0621/ctrl-zebra/pull/144) | 2026-08-03 |
| 14 | T1404 | 已完成 | [#145](https://github.com/yangzuo0621/ctrl-zebra/pull/145) | 2026-08-03 |
| 14 | T1405 | 已完成 | [#146](https://github.com/yangzuo0621/ctrl-zebra/pull/146) | 2026-08-03 |
| 14 | T1406 | 已完成 | [#147](https://github.com/yangzuo0621/ctrl-zebra/pull/147) | 2026-08-03 |
| 14 | T1407 | 已完成 | [#148](https://github.com/yangzuo0621/ctrl-zebra/pull/148) | 2026-08-03 |
| 14 | T1408 | 已完成 | [#149](https://github.com/yangzuo0621/ctrl-zebra/pull/149) | 2026-08-03 |
| 14 | T1409 | 已完成 | [#150](https://github.com/yangzuo0621/ctrl-zebra/pull/150) | 2026-08-03 |
| 15 | T1501 | 已完成 | [#153](https://github.com/yangzuo0621/ctrl-zebra/pull/153) | 2026-08-09 |
| 15 | T1502 | 已完成 | [#155](https://github.com/yangzuo0621/ctrl-zebra/pull/155) | 2026-08-09 |
| 15 | T1503 | 已完成 | [#156](https://github.com/yangzuo0621/ctrl-zebra/pull/156) | 2026-08-09 |
| 15 | T1504 | 已完成 | [#158](https://github.com/yangzuo0621/ctrl-zebra/pull/158) | 2026-08-10 |
| 15 | T1505 | 已完成 | [#159](https://github.com/yangzuo0621/ctrl-zebra/pull/159) | 2026-08-10 |
| 15 | T1506 | 已完成 | [#160](https://github.com/yangzuo0621/ctrl-zebra/pull/160) | 2026-08-10 |
| 15 | T1507 | 已完成 | [#161](https://github.com/yangzuo0621/ctrl-zebra/pull/161) | 2026-08-10 |
| 15 | T1508 | 已完成 | [#162](https://github.com/yangzuo0621/ctrl-zebra/pull/162) | 2026-08-10 |
| 15 | T1509 | 已完成 | [#163](https://github.com/yangzuo0621/ctrl-zebra/pull/163) | 2026-08-10 |
| 15 | T1510 | 已完成 | [#164](https://github.com/yangzuo0621/ctrl-zebra/pull/164) | 2026-08-10 |
| 15 | T1511 | 已完成 | [#165](https://github.com/yangzuo0621/ctrl-zebra/pull/165) | 2026-08-10 |
| 16 | T1601 | 已完成 | [#172](https://github.com/yangzuo0621/ctrl-zebra/pull/172) | 2026-08-11 |
| 16 | T1602 | 已完成 | [#175](https://github.com/yangzuo0621/ctrl-zebra/pull/175) | 2026-08-11 |
| 16 | T1603 | 已完成 | [#177](https://github.com/yangzuo0621/ctrl-zebra/pull/177) | 2026-08-11 |
| 16 | T1604 | 已完成 | [#179](https://github.com/yangzuo0621/ctrl-zebra/pull/179) | 2026-08-11 |
| 16 | T1605 | 已完成 | [#181](https://github.com/yangzuo0621/ctrl-zebra/pull/181) | 2026-08-11 |
| 17 | T1701 | 已完成 | [#183](https://github.com/yangzuo0621/ctrl-zebra/pull/183) | 2026-08-11 |
| 17 | T1702 | 已完成 | [#184](https://github.com/yangzuo0621/ctrl-zebra/pull/184) | 2026-08-11 |
| 17 | T1703 | 已完成 | [#185](https://github.com/yangzuo0621/ctrl-zebra/pull/185) | 2026-08-11 |
| 18 | T1801 | 已完成 | [#188](https://github.com/yangzuo0621/ctrl-zebra/pull/188) | 2026-08-11 |
| 18 | T1802 | 已完成 | [#191](https://github.com/yangzuo0621/ctrl-zebra/pull/191) | 2026-08-12 |
| 18 | T1803 | 已完成 | [#193](https://github.com/yangzuo0621/ctrl-zebra/pull/193) | 2026-08-12 |
| 18 | T1804 | 已完成 | [#195](https://github.com/yangzuo0621/ctrl-zebra/pull/195) | 2026-08-12 |
| 18 | T1805 | 已完成 | [#197](https://github.com/yangzuo0621/ctrl-zebra/pull/197) | 2026-08-12 |
| 18 | T1806 | 已完成 | [#198](https://github.com/yangzuo0621/ctrl-zebra/pull/198) | 2026-08-12 |
| 18 | T1807 | 已完成 | [#199](https://github.com/yangzuo0621/ctrl-zebra/pull/199) | 2026-08-12 |
| 19 | T1901 | 已完成 | [#201](https://github.com/yangzuo0621/ctrl-zebra/pull/201) | 2026-08-12 |
| 19 | T1902 | 已完成 | [#203](https://github.com/yangzuo0621/ctrl-zebra/pull/203) | 2026-08-12 |
| 19 | T1903 | 已完成 | [#204](https://github.com/yangzuo0621/ctrl-zebra/pull/204) | 2026-08-12 |
| 19 | T1904 | 已完成 | [#205](https://github.com/yangzuo0621/ctrl-zebra/pull/205) | 2026-08-12 |
| 19 | T1905 | 已完成 | [#207](https://github.com/yangzuo0621/ctrl-zebra/pull/207) | 2026-08-12 |
| 20 | T2001 | 已完成 | [#227](https://github.com/yangzuo0621/ctrl-zebra/pull/227) | 2026-08-13 |
| 20 | T2002 | 待开始 | — | — |
| 20 | T2003 | 待开始 | — | — |
| 20 | T2004 | 待开始 | — | — |
| 20 | T2005 | 待开始 | — | — |
| 21 | T2101 | 待开始 | — | — |
| 21 | T2102 | 待开始 | — | — |
| 21 | T2103 | 待开始 | — | — |
| 21 | T2104 | 待开始 | — | — |
| 21 | T2105 | 待开始 | — | — |
| 21 | T2106 | 待开始 | — | — |
| 22 | T2201 | 待开始 | — | — |
| 22 | T2202 | 待开始 | — | — |
| 22 | T2203 | 待开始 | — | — |
| 22 | T2204 | 待开始 | — | — |
| 22 | T2205 | 待开始 | — | — |
| 22 | T2206 | 待开始 | — | — |
| 22 | T2207 | 待开始 | — | — |
| 22 | T2208 | 待开始 | — | — |

### 当前任务

- ID：T2001
- 状态：已完成（docs-only 约束；PR #227 已审阅并合并）
- 目标：确定文件创建、删除、重命名、单文件/多文件编辑的不可变计划、精确一次性审批、Diff、
  Checkpoint、原子提交、失败优先级、恢复/兼容规则，并固定显式 RE2-compatible regex 搜索契约。
- 前置条件：Phase 19 已归档；Workspace Trust、规范 URI、现有 `propose_file_edit`、Approval、
  Diff Presenter、WorkspaceEdit applier 和 Checkpoint store 已存在。
- 计划修改的文件：`docs/implementation-plan.md`、`docs/architecture.md`、`docs/protocol.md`、
  `docs/security.md`、`docs/persistence.md`、`docs/ux.md`、`docs/webview.md`、
  `docs/roadmap/product-foundation.md`、`PRIVACY.md`、`docs/engineering-opportunities.md`。
- 明确不做：T2002–T2005 runtime 实现、Protocol/Schema 源码、Extension/Webview 代码、依赖或
  lockfile、目录递归删除、覆盖写、自动回滚、批量永久授权、工作区外操作、regex engine 接入。

### Reuse Audit

- 计划新增的行为与符号：`propose_file_create`、`propose_file_delete`、`propose_file_rename`、
  `propose_workspace_edit` 的计划/DTO 语义；`search_files.mode: "regex"` 的 dialect/limit/failure
  contract；Checkpoint before/after state union。
- 初始全仓搜索命令、关键词与 engineering-opportunity 记录：`rg -n --hidden -S
  "propose_file_edit|TextEditPlan|WorkspaceEdit|Checkpoint|Approval|Diff|search_files|regex"
  packages apps docs`；审阅 `docs/reviews/REVIEW-2026-08-06.md` K.1–K.3、EO-008、现有
  `docs/architecture.md`、`docs/security.md`、`docs/persistence.md`。
- 找到的现有实现（路径、符号、语义 owner）：`packages/builtin-tools/src/propose-file-edit.ts`
  （单文件输入/plan，Builtin Tool owner）；`packages/core/src/text-edit.ts`
  （排序/重叠校验，Core owner）；`apps/extension/src/controllers/file-edit-approval-workflow.ts`
  （精确审批/生命周期，Extension controller owner）；`apps/extension/src/adapters/diff-presenter.ts`
  （临时 Diff，Extension owner）；`apps/extension/src/adapters/workspace-edit-applier.ts`
  （写前 revision/Checkpoint/WorkspaceEdit，Extension owner）；`packages/protocol/src/checkpoint.ts`
  与 `packages/core/src/checkpoint-store.ts`（Checkpoint Schema/store owner）；
  `packages/builtin-tools/src/search-files.ts`（literal search owner）。
- 决定：直接复用既有 single-file edit/approval/Diff/Checkpoint owners；新增 Tool 名称仅扩展
  语义边界，不复制其算法。Regex 通过 package-local controlled interface 评估，T2001 不实现。
- 未复用理由：旧 `propose_file_edit` 的单 `path`/edit 语义不能安全改成文件数组；create/delete/
  rename 的存在状态不同，需 distinct public operations；共享错误通过现有 stable mapping，
  不新增仓库级 `utils`。
- 是否形成第二份或第三份实现：否。T2005 必须删除任何被采用方案取代的 parser/guard；
  T2002–T2004 直接调用现有 canonicalization, text-bound, approval, Diff, checkpoint and
  WorkspaceEdit seams。
- 执行中将主动调用或深化的已有功能：`parseTextEdits`/`TextEditPlan`、`FileEditApprovalWorkflow`、
  `WorkspaceEditApplier`、`AtomicCheckpointStore`、`DiffPresenter`、`search_files` truncation。

### Final Similarity Audit

- 复查范围：契约稳定后再次执行全仓搜索（排除 `node_modules`、`dist`、`.artifacts` 和
  VS Code 测试缓存）：`rg -n --hidden -S
  "propose_file_create|propose_file_delete|propose_file_rename|propose_workspace_edit|FileMutationPlanDto|FileMutationTargetDto|FileMutationStateDto|FileMutationDiffDto|FileMutationOutcomeDto|mode: \"regex\"|search_files|TextEditPlan|parseTextEdits|FileEditApprovalWorkflow|WorkspaceEditApplier|DiffPresenter|Checkpoint"
  .`。复查确认本任务提交没有新增 runtime 文件、实现符号或测试 fake。
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

- Similarity delta：新增行为和 DTO 词汇的 runtime 定义数均为零；唯一实际 delta 是十个文档文件
  中的 additive contract text。没有删除或替代实现、没有重复 serializer/parser/regex/diff/approval
  算法，也没有新增 dependency、fake、wrapper 或公共 API 源码。
- 第二/第三实现判定：不存在第二份 T2001 runtime 实现；T2002–T2005 必须在实现前重新搜索并
  证明直接复用或深化上述 owner。若采用 `re2js`，其 adapter 只能由 T2005 在既有
  `search_files` owner 后方受控接入，并须删除被替代的 parser/guard；T2001 不授权该依赖。
- 未复用项及 disposition：旧 `propose_file_edit` 不能承载 create/delete/rename 或文件数组，故
  保持其单文件公共语义并新增名称；原生 JS `RegExp`、未经筛选的 `re2js` LOOKBEHINDS、原生
  `re2` addon 和自建 regex VM 均仅留在 EO-008/T2005 评估，不进入本提交。

### Build vs Buy

- 涉及的通用机制：正则引擎（EO-008）、Diff/patch/序列化和原子 WorkspaceEdit；仅定义契约，不在
  T2001 实现通用算法。
- 触发条件：通用正则/复杂度边界和已有 Diff/Checkpoint/WorkspaceEdit 机制；需完成 Build vs Buy
  证据后才能在 T2005/T2004 采用实现。
- 标准库或 VS Code API：VS Code `WorkspaceEdit` 负责 Host-owned atomic submission；原生
  JavaScript `RegExp` 不满足 ReDoS 安全契约。
- 现有依赖：当前无受控 RE2 engine；现有 text bounds, Diff Presenter, Checkpoint store and
  approval workflow are reused。
- 官方 SDK 或第三方候选：Google RE2/RE2 syntax（Context7 `/google/re2`）；纯 JS `re2js@2.8.5`
  （MIT, 0 runtime deps, ESM/CJS, built-in types, but README exposes non-RE2 LOOKBEHINDS）；
  Node native `re2`（native addon/VSIX platform burden）。
- 决定：T2001 固定 RE2-compatible product dialect，暂不引入依赖；`re2js` 仅为 T2005 条件候选，
  必须由 CtrlZebra-owned adapter 拒绝 look-around/其他扩展并证明 bounds/cancellation。
- 理由与证据：RE2 Context7 文档确认 linear-time、non-backtracking、拒绝 backreference/look-around；
  npm/GitHub 当前 re2js metadata/README 证明其 pure-JS、MIT、ESM/CJS、线性目标但包含 lookbehind
  extension，因此不是未经筛选的 drop-in。
- 影响：不改变当前 lockfile/VSIX；T2005 需评估包体、Unicode、编译状态、取消粒度和恶意 corpus；
  第三方类型/错误不得进入 Protocol/Core。
- 隔离边界：Builtin Tool/Extension-owned controlled regex interface；第三方 pattern/match/error
  types remain private。

### 测试计划

- 单元测试：T2002–T2004 覆盖正常路径、目标存在/缺失、stale、重复/重叠、Trust/URI/二进制/超限、
  approval invalidation, checkpoint durability, zero-write preflight, atomic apply failure, cancel,
  restore and legacy compatibility. T2005 covers literal parity, strict RE2 syntax, rejected
  backreference/look-around, catastrophic corpus, Unicode/empty matches, complexity and cancellation
  budgets, file/result limits and truncation.
- 集成测试：Extension registration, canonical workspace adapter, exact approval/WorkspaceEdit,
  checkpoint persistence and restore, VS Code multi-file atomic apply, plus VSIX smoke for create,
  delete, rename, edit and restore. T2001 itself runs docs anchor/contract validation only.
- 人工烟雾测试：trusted workspace create/delete/rename/edit/recovery; untrusted/stale/target race;
  multi-file Diff grouping; literal search unchanged and explicit regex refusal/limit status.

### 约束门禁

- 需要新建或更新的规范：Architecture, Protocol, Security, Persistence, UX, Webview,
  Product Foundation, Privacy, and EO-008 ledger; implementation-plan records startup state.
- 必须覆盖的规则：exact Tool names and immutable plans; bounded UTF-8 text/path/target limits;
  stale/identity/Trust checks immediately before side effects; one approval/Checkpoint/WorkspaceEdit;
  zero writes on preflight failure; deterministic failure precedence; explicit all-target restore;
  legacy Checkpoint compatibility; explicit regex mode with RE2-compatible syntax and bounded execution.
- 是否需要独立约束 PR（docs-only / config-only）：是，T2001 itself is the independent docs-only
  constraint PR. Runtime tasks remain blocked until this PR is reviewed and squash-merged.

### T2001 完成记录

- 完成摘要：完成文件创建、删除、重命名、单文件/多文件编辑的不可变计划、精确一次性审批、Diff、
  Checkpoint、原子提交、失败优先级、恢复/兼容规则及显式 RE2-compatible regex 搜索契约；本任务
  仅更新规范与约束文档，未引入 runtime 实现、依赖或 Schema 源码。
- 完成证据：[PR #227](https://github.com/yangzuo0621/ctrl-zebra/pull/227)，审阅通过 revision
  `bab91b1b07222c1fd83cea9ed40e7e476d4a9ce7`；GitHub Actions Ubuntu、macOS、Windows required
  checks 均通过；本地 package/smoke 验证、`pnpm check` 与 `git diff --check` 均通过。
- 完成日期：2026-08-13
- 下一任务：T2002；T2005 负责 EO-008 `re2js` fit evaluation 与受控 regex engine 选型。

---

### T1901 完成记录

- 完成摘要：仅定义 IDE context 与 read-only Tool 契约；docs-only PR #201 即为完整任务产物，T1902 负责实现 Host adapter。
- 完成证据：[PR #201](https://github.com/yangzuo0621/ctrl-zebra/pull/201)，squash merge revision `d15efff1fd6f09d07abad9fd7f427b2d052a2b19`；GitHub Actions run `31544541307` 的 Ubuntu、macOS、Windows 验证均通过；`pnpm check`、`git diff --check` 及 T1901 跨文档 anchor/file validation 均通过。
- 完成日期：2026-08-12
- 下一任务：T1902

---

### T1902 完成记录

- 完成摘要：实现 IDE editor context Host adapter、read-only Tool 注册与 bounded editor/selection projection，覆盖活动编辑器、selection、可见范围和打开编辑器信息；接入 protocol、builtin Tool、registry，并保留 workspace/trust、取消、预算、竞态与硬限制边界，同时遵守 disabled setting boundary（T1905）。
- 完成证据：[PR #203](https://github.com/yangzuo0621/ctrl-zebra/pull/203)，实现 revision `2bbe094e30cf9aed2fdc14322e1e4601ad75840d`；GitHub Actions run `31548420686` 的 Ubuntu、macOS、Windows 验证均通过（Ubuntu integration tests、coverage gate、build 均通过）；实现 revision 的单元测试、类型检查、格式/lint、构建及 `git diff --check` 均通过。
- 完成日期：2026-08-12
- 下一任务：T1903

---

### T1903 完成记录

- 完成摘要：实现结构化 diagnostics Tool，接入 VS Code diagnostics Host adapter；对语言、来源聚合、去重、排序、预算、取消、workspace/trust 与输出边界提供约束和回归覆盖。
- 完成证据：[PR #204](https://github.com/yangzuo0621/ctrl-zebra/pull/204)，实现 revision `8d1ce7f4356293984774010080a376f30232579f`；聚焦测试、完整单元测试、类型检查、Biome 检查、构建、Ubuntu 集成测试、coverage gate 及 `git diff --check` 均通过；GitHub Actions run `31551947592` 的 Ubuntu、macOS、Windows 验证均通过。
- 完成日期：2026-08-12
- 下一任务：T1904

### T1904 完成记录

- 完成摘要：实现 VS Code 语言服务定义、引用和符号查询的最小只读 Tool 集合；复用现有 Provider 命令，校验返回 URI 与范围，并对 workspace/trust、取消、Provider 失败、结果数量和 URI 组件实施确定性边界。
- 完成证据：[PR #205](https://github.com/yangzuo0621/ctrl-zebra/pull/205)，实现 revision `94f75d55c00a3b00ca1b1b7948be5317c4ca857a`；GitHub Actions run `31556983168` 的 Ubuntu、macOS、Windows 验证均通过（实际 required checks）；实现 revision 的聚焦/完整测试、类型检查、Biome 检查、构建及 `git diff --check` 均通过。
- 完成日期：2026-08-12
- 下一任务：T1905；Phase 19 归档门禁完成后方可进入 T2001。

---

### T1905 完成记录

- 完成摘要：实现显式 Ask about Selection / Ask about Active File 入口与可选 editor context 流程；完成 Protocol-v1 DTO、Host capture/owner gates、取消与 stale fencing、去重、clear/overflow 边界，以及 Webview 来源草稿、stale/use-stale/remove 控件、会话/新聊天/销毁清理和无障碍播报；仅在 `ctrlZebra.editorContext.enabled` 启用时接入 staged read-editor-context Tool。
- 完成证据：[PR #207](https://github.com/yangzuo0621/ctrl-zebra/pull/207)，生产实现 revision `9c991c3ac584095c9fadc7e2b702fae98227cb04`；最新验证 revision `79fb42ba6aff6afb530b8f9ef9f63beb398b87d9`（coverage gate 修复）。本地/PR 验证：完整单元测试 1699 个、T1905 聚焦测试、`pnpm check`、类型检查、`pnpm build`、集成测试（exit 0）、VSIX/package smoke、`git diff --check`；GitHub Actions run `31564300781` 的 Ubuntu、macOS、Windows required checks 全部通过，Ubuntu 集成测试与 coverage gate 均通过。
- 完成日期：2026-08-12
- 启动门禁：Phase 19 归档校验已于 2026-08-12 通过；T2001 于该门禁后按独立授权启动。

---

### T1701 完成记录

- 完成摘要：统一 Webview 产品语言与字符串所有权，集中用户可见文案，并统一屏幕阅读器播报、状态和错误文案。
- 完成证据：[PR #183](https://github.com/yangzuo0621/ctrl-zebra/pull/183)；单元测试（124 个文件、1466 个测试）、类型检查、Biome 检查（337 个文件）、Webview 构建及 `git diff --check` 均通过；GitHub CI 的 Ubuntu、macOS、Windows 验证均通过。
- 完成日期：2026-08-11
- 下一任务：T1702

### T1702 完成记录

- 完成摘要：实现受限的技术 Markdown 呈现，支持常用技术结构并阻断原始 HTML、危险链接协议与未授权资源；通过 Extension/VS Code 打开外链。
- 完成证据：[PR #184](https://github.com/yangzuo0621/ctrl-zebra/pull/184)；聚焦测试 31/31、完整单元测试（125 个文件、1482 个测试）、类型检查、Biome 检查、Webview 构建、集成测试（exit 0）及 `git diff --check` 均通过；GitHub CI 的 Ubuntu、macOS、Windows 验证均通过。
- 完成日期：2026-08-11
- 下一任务：T1703

### T1703 完成记录

- 完成摘要：修复 assistant 消息气泡样式选择器与角色契约失配，并补充角色属性与布局回归覆盖。
- 完成证据：[PR #185](https://github.com/yangzuo0621/ctrl-zebra/pull/185)；GitHub CI 的 Ubuntu、macOS、Windows 验证均通过（格式与 lint、类型检查、单元测试、构建；Ubuntu 另含集成测试与覆盖率门禁）；`git diff --check` 通过。
- 完成日期：2026-08-11
- 下一任务：T1801

### T1801 完成记录

- 完成摘要：实现 MCP Tool Schema 的单工具失败隔离、稳定拒绝原因与有界 `rejectedTools` 投影；以带序列号的单一 combined extension/mcp-tool-catalog 扩展投影原子发布接受与拒绝结果，同时保持 legacy extension/mcp-tools 兼容，并覆盖分页、刷新、断开竞态、上限与旧客户端兼容。
- 完成证据：[PR #188](https://github.com/yangzuo0621/ctrl-zebra/pull/188)；实现 revision `4bc1efc` 的 GitHub Actions run `31507602189` 中 Ubuntu、macOS、Windows 均通过，并完成 `pnpm check`、`pnpm typecheck`、完整单元测试（1503 个）、集成测试、聚焦 T1801 测试及 `git diff --check`；后续 closure-only 计划文档提交以 required checks 作为合并门禁。
- 完成日期：2026-08-11
- 下一任务：T1802

### T1802 完成记录

- 完成摘要：按已归档的 Schema 关键字分类与引用规则规范化 MCP Tool Schema，保留受支持关键字并以稳定 reason 拒绝不支持结构，不泄漏 schema 路径信息。
- 完成证据：[PR #191](https://github.com/yangzuo0621/ctrl-zebra/pull/191)，最终实现 revision `0a23753fb9d0f7a4de92f20980f51b7d74bc3af5`；最新本地聚焦测试 45/45、MCP 测试 110/110、完整单元测试 1517 个、集成测试 exit 0、`pnpm check`、`pnpm typecheck` 与 `git diff --check` 均通过；GitHub Actions run `31512898994` 的 Ubuntu、macOS、Windows 验证均通过。
- 完成日期：2026-08-12
- 下一任务：T1803

### T1803 完成记录

- 完成摘要：实现 MCP 诊断恢复投影与连接生命周期竞态防护，清理断开与重连诊断，隔离过期刷新/清理意图及失败，并补充 UTF-8 诊断截断覆盖。
- 完成证据：[PR #193](https://github.com/yangzuo0621/ctrl-zebra/pull/193)，最终实现 revision `e98e7b3631a9593977732fdc63b2437bbe10a787`；本地单元测试 1535 个、`pnpm check`、`pnpm typecheck`、构建、集成测试及 `git diff --check` 均通过；GitHub Actions run `31521263866` 的 Ubuntu、macOS、Windows 验证均通过。
- 完成日期：2026-08-12
- 下一任务：T1804

### T1804 完成记录

- 完成摘要：固化双纪元 MCP 配置、启动身份与激活门禁，实现协商/降级错误分类、协议与持久化契约、兼容 fixtures 及扩展侧验证。
- 完成证据：[PR #195](https://github.com/yangzuo0621/ctrl-zebra/pull/195)，最终实现 revision `fc8e31a62f1528382ea498ed551eff97640cf7d3`；GitHub Actions run `31529057458` 的 Ubuntu、macOS、Windows 验证均通过；本地 `pnpm test`（1552）、`pnpm check`、`pnpm typecheck`、VSIX 构建、差异/Parity 校验及 `git diff --check` 均通过。
- 完成日期：2026-08-12
- 下一任务：T1805

### T1805 完成记录

- 完成摘要：在 `packages/mcp-client` 实现 modern-first stdio 双纪元探测与协商：有界 `server/discover`、modern 成功/可识别错误锁定、dual 模式下仅对规范允许的非 modern 结果或超时执行一次 legacy 回退；取消、malformed、超限、进程退出、Trust 失效、清理失败和迟到 probe 结果均不会触发错误回退，并覆盖版本闭集与重复协商边界。
- 完成证据：[PR #197](https://github.com/yangzuo0621/ctrl-zebra/pull/197)，实现 revision `83a1f136e9904e8e9e3e616385516094513912f2`；GitHub Actions run `31532442329` 的 Ubuntu、macOS、Windows 验证均通过；本地 MCP 聚焦测试 132 个、完整测试 1574 个、`pnpm typecheck`、`pnpm check`、构建、集成测试及 `git diff --check` 均通过。
- 完成日期：2026-08-12
- 下一任务：T1806

### T1806 完成记录

- 完成摘要：加固 legacy MCP 请求边界，拒绝不符合安全矩阵的 Server 请求并补齐边界验证。
- 完成证据：[PR #198](https://github.com/yangzuo0621/ctrl-zebra/pull/198)，最终实现 revision `effe08d35c10014c4105dd54af292750984f4351`；GitHub Actions run `31534831357` 的 Ubuntu、macOS、Windows 验证均通过；本地 MCP 聚焦测试 138 个、完整测试 1580 个、`pnpm typecheck`、`pnpm check`、构建、集成测试及 `git diff --check` 均通过。
- 完成日期：2026-08-12
- 下一任务：T1807（阶段 18 全部任务完成后先进行阶段性归档校验，再进入阶段 19）

### T1807 完成记录

- 完成摘要：完成 Extension mode-aware wiring、Webview configured/negotiated UI、bounded persistence provenance/recovery no reconnect，以及 real stdio fixtures/e2e/VSIX evidence，满足任务验收要求。
- 完成证据：[PR #199](https://github.com/yangzuo0621/ctrl-zebra/pull/199)，实现 revision `570531bfc69c6b76ab8386d37483154d5d7266dc`；GitHub Actions run `31539176012` 的 Ubuntu、macOS、Windows 验证均通过；本地 unit 1585、`pnpm check`、`pnpm typecheck`、VSIX 构建、smoke、build、integration 及 `git diff --check` 均通过。
- 完成日期：2026-08-12
- 下一任务：T1901（阶段 18 归档校验门禁通过后方可启动）

---

## 5. 阶段规格索引

阶段 0–19 已完成，完整任务正文均已按阶段归档。阶段 20–22 已规划，等待依次开始。

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
| 11 | 已完成 | [阶段 11 归档](roadmap/archive/phase-11.md) |
| 12 | 已完成 | [阶段 12 归档](roadmap/archive/phase-12.md) |
| 13 | 已完成 | [阶段 13 归档](roadmap/archive/phase-13.md) |
| 14 | 已完成 | [阶段 14 归档](roadmap/archive/phase-14.md) |
| 15 | 已完成 | [阶段 15 归档](roadmap/archive/phase-15.md) |
| 16 | 已完成 | [阶段 16 归档](roadmap/archive/phase-16.md) |
| 17 | 已完成 | [阶段 17 归档](roadmap/archive/phase-17.md) |
| 18 | 已完成 | [阶段 18 归档](roadmap/archive/phase-18.md) |
| 19 | 已完成 | [阶段 19 归档](roadmap/archive/phase-19.md) |
| 20 | 已规划 | [阶段 20：文件生命周期与工作区编辑](roadmap/phases/phase-20.md) |
| 21 | 已规划 | [阶段 21：对话交互与会话数据控制](roadmap/phases/phase-21.md) |
| 22 | 已规划 | [阶段 22：Preview 与 GA 工程就绪](roadmap/phases/phase-22.md) |

## 6. 后续能力候选顺序

阶段 15–22 已根据 [2026-08-06 工程评估](reviews/REVIEW-2026-08-06.md) 纳入计划；逐项决定见
[评估采纳与处置矩阵](roadmap/review-adoption-2026-08-06.md)。该评估是建议来源，不拥有任务顺序、
公共契约或完成状态；本索引与对应阶段规格才是执行依据。

尚未获准的复用、模块深化、依赖引入和重复消除候选记录在[工程机会台账](engineering-opportunities.md)。
台账中的 `EO-*` 不是任务编号，不改变本索引的执行顺序或状态；候选项只有经明确批准并晋升为
路线图任务或独立 maintenance 后才能实施。

完成阶段 22 后，按以下顺序评估后续能力：

1. 任务级评测基线，作为策略、循环和委派能力的共同前置。
2. Plan/Act 模式，验证可审阅计划与现有 Tool Policy、审批和取消边界。
3. 循环约束放宽与失败反思；当前运行循环已经具备推理与行动交替结构，不另设“引入 ReAct”任务。
4. 项目级规则文件；先验证单一、可见、普通用户上下文的规则文件，再评估 Skills 渐进披露。
5. Skills；工作区来源始终不可信，不进入 System 权威，不执行附带脚本，正式规划前需要独立安全决策。
6. 跨会话记忆；必须先具备会话删除、保留策略和可见、可编辑、可删除的记忆投影。
7. Git 状态感知和提交辅助；不包含自动提交或自动创建 PR。
8. MCP 远程传输与授权扩展：Streamable HTTP + OAuth；详细记录见
   [阶段 14 后续扩展](roadmap/archive/phase-14.md#7-后续扩展记录)。
9. 更多专用模型供应商，继续验证 Provider 边界。
10. 多 Agent；只有评测证明收益后才可规划，首个版本只允许只读子 Agent。

多 Agent 必须建立在可恢复的多轮 Session、确定性 Tool 生命周期、父子取消传播、共享资源预算和
隔离之上。自建代码语义索引不再是默认候选；阶段 19 的 VS Code/LSP 能力完成后，只有存在经过
评测证明且无法由语言服务满足的检索缺口时才重新提出。

以下项目尚未获准进入任务台账：旧于 `2025-11-25` 或未知未来版本的 MCP、Skills、跨会话记忆、
多 Agent、多模态输入和运行中插话。它们各自需要新的路线图变更控制；涉及产品范围、信任模型或
长期架构时还需同步产品基础规格和 ADR。

## 7. 任务执行模板

开始和完成任务时使用 [任务执行模板](roadmap/task-template.md)。

## 8. 变更控制

如果实施中需要改变模块边界、技术基线或任务顺序：

1. 先说明当前任务遇到的具体证据。
2. 写出至少一个替代方案和影响。
3. 更新本文档，再修改代码。
4. 不以“顺手重构”为理由扩大当前任务范围。

新增需求默认进入后续候选清单，不直接插入正在执行的最小任务。
