# 阶段 13：可解释的推理摘要展示

## 1. 阶段目标

在不声称暴露模型原始思维链的前提下，将 Provider 明确返回的用户可见推理摘要作为独立、
可选、受限的流式内容展示在对话中。推理摘要与最终回答、Tool 调用和 Extension Host
拥有的运行状态保持可辨识的来源与语义，用户可以理解模型正在处理问题，但不会把产品生成的
说明、工具轨迹或隐藏推理误认为同一种内容。

当前 Vercel AI SDK 7 流能够产生 `reasoning-start`、`reasoning-delta` 和
`reasoning-end`，但 `packages/providers` 会忽略这些事件；Core `ModelEvent`、Agent
Runtime、Extension/Webview 协议、持久化恢复和 Webview Store 也没有对应的内部契约。
本阶段沿用现有模块方向打通该事件链，不把第三方 SDK 类型或 Provider metadata 泄漏到
Core、协议、持久化或 Webview。

## 2. 方案选择与变更控制

本阶段采用“Provider 原生推理摘要”方案：

- 只展示 Provider 通过正式流事件返回的 reasoning 文本，并在 UI 中称为“推理摘要”或语义
  等价的准确名称。
- 没有 reasoning 事件时保持现有回答与 Tool 流程，不显示空卡片、不报错，也不预测某个模型
  一定支持该能力。
- 推理摘要、最终回答和现有 Tool 卡保持独立；本阶段不把工具轨迹重组为新的统一时间线。
- 不通过 System Prompt 要求模型逐步公开思考，不额外调用模型生成事后“思维链”，也不把
  Extension 自己推断的步骤伪装成模型输出。

未采用的替代方案：

- **提示词生成逐步思考**：跨 Provider 行为不稳定，会增加 Token、延迟和成本，并可能产生
  看似可信但无法验证的过程，因此不采用。
- **只展示 Host 运行轨迹**：来源确定且跨 Provider 可用，但现有 Tool 卡和运行状态已经承担
  这部分职责，不能替代用户要求的 Provider 推理摘要；如需统一活动时间线，应另建任务。
- **建立静态模型能力表**：推理支持可能受 Provider、模型、端点和请求参数共同影响，静态表
  容易过时。本阶段将 reasoning 作为可选流事件处理，以实际收到的事件为准。

T1301 是强制 docs-only 约束门禁。它必须先合入 `main`，后续实现任务才能开始。如果门禁
发现 Provider 的正式 reasoning 事件不是用户可见摘要、必须保存不透明或加密内容才能继续
会话，或现有持久化版本无法安全迁移，应停止并重新进行变更控制，而不是降级为展示原始响应。

## 3. 前置条件与任务顺序

- 阶段 0–12 已完成；现有文本流、Agent Loop、Tool 生命周期、取消、持久化和恢复行为是本阶段
  的回归基线。
- 严格按 T1301 → T1302 → T1303 → T1304 执行，一次只领取一个任务。
- 每个任务从最新远端 `main` 建立独立分支和 PR，不与 Provider 升级、Tool UI 重构或其他
  后续能力混合。
- T1301 更新长期契约；T1302–T1304 只能实现已经合入的契约，不得在代码 PR 中重新定义产品
  语义、持久化策略或边界。
- T1302 涉及 Vercel AI SDK，T1304 涉及 React 和 Testing Library；实现前按仓库规则通过
  Context7 获取对应当前文档。

## 4. 任务规格

### T1301：建立推理摘要的产品与跨边界契约

**目标**：在编写实现代码前，明确推理摘要的来源、命名、事件顺序、资源上限、取消语义、
持久化恢复、安全边界和 Webview 验收方式，使后续任务不依赖第三方 SDK 的隐式行为。

**产物**：

- 更新 `docs/roadmap/product-foundation.md`，把 Provider 原生推理摘要加入批准的桌面 Extension
  产品范围，并明确它不是原始或隐藏思维链。
- 更新 `docs/architecture.md`，定义 Provider-neutral reasoning 事件、块标识和有序生命周期，
  以及 Agent Runtime 对空块、交错文本、多个步骤、错误、完成和取消的处理。
- 更新 `docs/protocol.md`，定义严格、可关联、有界的 Extension → Webview 推理摘要消息；不复用
  正文 `text-delta`，不传递 Provider metadata、不透明加密内容或第三方 SDK 值。
- 更新 `docs/persistence.md`，定义推理摘要是否以及如何以版本化格式持久化，完整块、部分块、
  中断恢复和旧版本会话的确定性行为；恢复不得重新发起模型请求。
- 更新 `docs/security.md`，把 reasoning 文本作为不可信模型输出处理，规定限长、截断、日志
  排除和敏感 metadata 排除规则。
- 更新 `docs/ux.md` 与 `docs/webview.md`，明确“推理摘要”命名、来源标识、折叠行为、流式批处理、
  焦点、滚动、Live Region 和窄侧栏验收。
- 如果最终选择改变长期模块边界、持久化格式原则或模型上下文语义，记录 ADR；普通 DTO 和
  组件细节不单独建立 ADR。

**测试**：

- 检查所有新增内部事件、协议消息和持久化术语在权威文档之间含义一致。
- 检查新旧会话兼容、取消后无后续 delta、无 reasoning 时的无操作行为和最大内容边界均有
  明确规则。
- 验证 Markdown 链接、任务引用和 `git diff --check`。

**排除项**：

- 修改 TypeScript、依赖、构建配置、Schema 或测试代码。
- 以提示词生成、补写或重建模型思维过程。
- 设计统一 Tool/模型活动时间线或新的 Plan/Act 模式。

### T1302：标准化 Provider reasoning 流并接入 Core Runtime

**目标**：将 SDK reasoning 流转换为 Provider-neutral Core 事件，并由 Agent Runtime 在保持
源顺序、取消和终态约束的前提下向上游发布。

**产物**：

- 扩展 `ModelEvent`、Agent Runtime 事件和 Testkit Fake，使 reasoning 块具有稳定的内部标识和
  T1301 规定的 start/delta/end 语义。
- OpenAI、Gemini 和 OpenAI-Compatible 适配器只在底层 SDK 实际产生正式 reasoning 事件时
  进行标准化；没有事件的流保持现有行为。
- 丢弃或隔离 Provider metadata、不透明加密 reasoning、原始响应和第三方错误对象，不使其
  进入 Core 公共值。
- 对 malformed 顺序、空内容、重复结束、多个 reasoning 块、与正文或 Tool Call 交错、流失败
  和中途取消执行确定性处理。
- 保持现有重试规则：一旦任何用户可观察事件已经发出，不因后续失败重新开始一次可能重复的流。

**测试**：

- Provider 单元测试覆盖至少一个正常 reasoning 块、多个块或与正文交错、无 reasoning、
  malformed 事件和取消后无后续事件。
- Core Runtime 测试覆盖事件源顺序、终态、流失败、取消和 Tool 循环边界。
- 运行 Providers、Core、Testkit 的类型检查和测试，再运行既有仓库级检查及
  `git diff --check`。

**排除项**：

- 修改 Webview 协议、持久化格式或 UI。
- 新增 Provider、升级 AI SDK 或建立静态模型能力表。
- 将 reasoning 文本插入模型上下文、Tool 输入、日志或最终回答。

### T1303：打通 Extension 协议、持久化与恢复

**目标**：把 Core reasoning 事件安全、按序地关联到当前运行并传递给 Webview，同时按照
T1301 的版本化策略保存和恢复用户可见摘要。

**产物**：

- 添加严格的 reasoning 协议 Schema、TypeScript DTO 和方向性消息联合，所有边界输入继续从
  `unknown` 校验。
- Extension Controller 只转发与活动 `requestId`、Session 和未终止运行匹配的事件；完成、
  失败或取消后忽略所有迟到 delta。
- 在收集过程中执行 T1301 规定的字符、字节、块数和总量边界，不先构造无界字符串再截断，并
  传递结构化截断状态。
- 按 T1301 确定的格式持久化和恢复推理摘要，保持 reasoning、正文与 Tool 事件的可辨识顺序；
  旧格式会话按明确兼容策略加载，损坏记录继续隔离。
- Session 恢复只重建展示状态，不继续 reasoning 流、不调用模型、不运行 Tool，也不产生其他
  副作用。

**测试**：

- Protocol 测试覆盖合法往返、未知字段、缺失关联、超限内容、非法顺序和截断标记。
- Extension 测试覆盖正常转发、多个块、无 reasoning、完成/失败/取消后的迟到事件以及
  requestId 不匹配。
- Persistence 测试和固定版本 fixture 覆盖正常恢复、部分块、中断 Session、旧版本和损坏记录。
- 运行 Protocol、Extension 和持久化相关类型检查与测试，再运行既有仓库级检查及
  `git diff --check`。

**排除项**：

- 实现 Webview 组件或改变现有 Tool 卡交互。
- 保存 Provider metadata、加密 reasoning、原始 SDK 响应或凭据相关数据。
- 自动恢复模型流、补全不完整摘要或把摘要加入下一轮模型上下文。

### T1304：实现可访问的推理摘要 Webview 体验

**目标**：在对话主路径中以独立、可折叠且来源准确的区域流式展示推理摘要，并在不支持该能力
时保持现有体验完全可用。

**产物**：

- Webview Store 按块标识批量组装 reasoning delta，组件只渲染 Store 快照，不在本地状态拼接
  Token。
- 对话中使用“推理摘要”或 T1301 规定的等价名称，与最终回答和 Tool 卡建立明确视觉层级；
  不使用“原始思维链”“完整思考”等误导性描述。
- 推理区域在流式期间提供可见进度，允许用户折叠且不会因新 delta 强制重新展开；终态和恢复态
  遵循 T1301 的默认折叠规则。
- 没有 reasoning 事件时不渲染占位卡、错误或虚构摘要；文本回答、Tool 调用、审批和取消行为
  保持不变。
- 内容使用安全文本渲染，支持复制、长文本、代码样式文本、窄侧栏、主题和缩放；流式更新不
  抢焦点、不逐 Token 播报，也不在用户向上阅读时强制滚动。
- README 或用户文档准确说明该能力取决于模型端实际返回的推理摘要，不承诺所有 Provider 或
  模型均可用。

**测试**：

- Store 测试覆盖批量有序组装、多个块、截断、恢复、终态 flush 和取消后迟到 delta。
- Testing Library 测试从用户行为覆盖展开/折叠、流式更新、无 reasoning、键盘操作、可访问
  名称和既有回答/Tool 回归。
- 人工验证 OpenAI、Gemini 和一个 OpenAI-Compatible 配置的“有摘要”和“无摘要”可用场景；
  不可获得真实摘要的 Provider 只验证确定性降级，不用提示词伪造测试数据。
- 人工覆盖 Light、Dark、High Contrast、High Contrast Light、约 300px 宽度、200% 缩放、
  长摘要、取消和恢复会话。
- 运行 Webview 与 Extension 相关测试、类型检查、既有仓库级检查以及 `git diff --check`。

**排除项**：

- 重新设计完整对话布局、Tool 卡、审批卡、输入区或会话导航。
- Markdown/HTML 富文本 reasoning、语法高亮器或远程资源。
- 用户编辑 reasoning、导出 reasoning、全局显示开关或按模型维护能力设置。

## 5. 阶段门禁

- UI 只展示 Provider 正式返回的用户可见推理摘要，产品文案不声称这是原始、隐藏或完整思维链。
- reasoning 通过 Provider → Core → Extension/Protocol → Webview 的自有类型传递，第三方 SDK
  类型、metadata、不透明或加密内容不越过 Provider 边界。
- 正文、reasoning、Tool Call、Usage 和 Finish 保持源顺序与独立语义；无 reasoning 时现有
  Agent 行为无回归。
- 取消、完成或失败后不接受迟到 reasoning delta；没有模型请求、Tool 执行、持久化副作用或
  UI 更新发生在取消之后。
- reasoning 内容有收集期硬上限、结构化截断状态和安全文本渲染，不进入诊断日志、Tool 输入或
  未经契约允许的模型上下文。
- 持久化、恢复和旧版本兼容遵循 T1301 合入的明确规则；恢复不补写摘要或恢复网络流。
- 折叠、键盘、焦点、Live Region、滚动、主题、窄宽度和 200% 缩放均有自动化或人工验证记录。
- 所有受影响包测试、类型检查、仓库级检查和 `git diff --check` 均有可报告结果。
