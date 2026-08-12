# 阶段 19：IDE 上下文与诊断闭环

## 1. 阶段目标

让 CtrlZebra 在用户控制下感知当前编辑位置，并通过 VS Code 已有诊断和语言服务形成只读反馈
闭环，使“这里”“这个错误”“查找引用”等 IDE 场景无需依靠全仓猜测。

## 2. 前置条件与范围

- 阶段 18 已完成。
- VS Code API、URI 转换、Workspace Trust 和宿主生命周期只由 Extension 拥有。
- 编辑器、选区、诊断和语言服务结果是不可信、可变且有界的普通上下文，不获得 System 权威。
- T1901 的 docs-only 约束 PR 先更新架构、协议、安全、隐私、UX 和 Webview 规则。

本阶段不包含自建语义/向量索引、后台索引、自动修改、Code Action 执行、工作区外文件、遥测或
把编辑器内容静默持久化为跨会话记忆。

## 3. 任务

### T1901：确定 IDE 上下文与只读 Tool 契约

定义用户控制、关闭选项、URI 范围、字符与 Token 上限、陈旧状态、Protocol DTO、来源展示、
持久化排除和取消规则；明确编辑器上下文进入普通用户上下文而非 System 指令。

### T1902：接入活动编辑器与选区上下文

实现 Host adapter 和有界投影，只读取明确选定工作区内受支持的文本；Session/编辑器切换、取消和
关闭后不产生迟到注入。测试无编辑器、空选区、工作区外 URI、二进制/超限文本、关闭设置和竞态。

### T1903：实现结构化诊断工具

新增只读诊断能力，返回有界 severity、范围、消息和来源；支持可选工作区路径；拒绝越界 URI，
明确截断。测试空结果、单文件/工作区、陈旧诊断、超限、取消和不可信消息。

### T1904：工具化 VS Code 语言服务

实现定义、引用和符号查询的最小只读工具集合；调用现有 Provider 命令，不建立缓存或索引；验证
所有返回 URI 和范围。测试无语言服务、多结果、工作区外结果、超限、取消和 Provider 失败。

### T1905：增加编辑器发起入口

提供从选区或活动文件显式打开/填充提问的命令与菜单；发送前保持用户可见可编辑，不自动运行
模型或授予权限。测试命令注册、上下文来源、焦点、取消、无选区和不可信工作区。

本任务的公共入口和跨边界名称固定如下，后续实现不得另行命名：

- 设置为 `ctrlZebra.editorContext.enabled`，布尔值、默认 `false`、`window` scope。设置关闭时
  两个入口保持不可用，待发送编辑器上下文同步清除；设置只允许用户显式打开，不因打开侧栏、焦点、
  光标移动或模型活动而自动打开。
- 命令为 `ctrlZebra.askAboutSelection`（`CtrlZebra: Ask about Selection`）和
  `ctrlZebra.askAboutFile`（`CtrlZebra: Ask about Active File`）。两者均贡献到 Command Palette；
  也贡献到 `editor/context` 菜单，分别使用 `editorHasSelection` 与 `editorTextFocus`，并以
  `config.ctrlZebra.editorContext.enabled` 作为 enablement。命令执行时 Host 仍必须重新验证设置、
  当前活动编辑器、选区、Workspace Trust、选定根和文档版本；when/enablement 仅为显示提示，不能
  替代 Host 校验。
- Host 向当前 Agent Webview 发送严格的 `extension/editor-context` 投影。成功状态携带 Host 生成的
  有界 `contextId`、`scope` 和 `IdeTextContextDto`；`stale` 状态只携带同一来源的 DTO（其中
  `source.stale` 必须为 `true`）；清除和不可用状态使用闭合 reason。每条 Host 事件严格携带
  Host-issued `requestId`/`eventSequence`、`viewGeneration`、`sessionGeneration`，以及适用的
  `cardGeneration`/`contextId`；`captureId` 只出现在 `ready`/`stale`，`cleared` 刻意省略它并仅以
  当前 owner 的 `cardGeneration`/`contextId` 关联；旧请求、旧 `captureId`/`contextId`、已取消或已
  关闭的 view 均被 Webview 忽略。
- Webview 只发送严格、带完整当前 owner tuple 的窄意图：
  `webview/editor-context-refresh`（`requestId`、`viewGeneration`、`sessionGeneration`、
  `cardGeneration`、`contextId`、`scope`）、`webview/editor-context-remove`（除 `scope` 外同样
  字段）和 `webview/editor-context-use-stale`（除 `scope` 外同样字段）。Refresh 会取消同一 view
  上一个未完成 capture；Remove 先同步清除本地卡片，再尝试发送一次意图；Use stale 只记录当前
  发送确认，不改变 Host 的 URI、范围、版本、Trust 或文本。
  取消、dispose、Session/New chat、设置关闭和 Trust 丢失关闭 delivery gate，之后不得发送文本、
  失败结果、重试或迟到 Webview 消息。
- 成功投影在 Composer 上方显示固定 `Editor context` 来源、工作区相对路径、语言、精确范围以及
  `Stale`/`Truncated` 状态；Host 产生的文本作为普通、不可信用户上下文插入 Composer 的可编辑草稿。
  用户在发送前可以修改或删除草稿，也可以 Remove；未明确 `Use stale context` 前 stale 草稿的
  Send 必须禁用；ready 草稿在审阅/编辑后可以直接 Send。该入口只填充草稿和来源卡片，绝不创建
  Run、执行模型、调用 Tool 或授予 Approval。

生命周期必须区分两个 gate：capture delivery gate 在有界读取和 `postMessage` enqueue 前拥有
`AbortController`，取消/Refresh/关闭/设置/Trust/工作区/编辑器或 Session 变化先关闭它，之后不
产生任何 capture completion；delivered-card/event projection owner gate 只在 ready enqueue commit
后以 `(viewGeneration, sessionGeneration, cardGeneration, contextId)` 建立。只有当前 owner gate
存在时，capture gate 关闭后才允许一次有界 stale（编辑器/选区/文档变化）或 Host 驱动的 cleared
（设置/Trust/工作区/不支持编辑器）事件；没有已交付 card 时不得发送迟到 stale/cleared。Remove 和
接受的 New chat 由 Webview 在发送单一意图/动作前同步清除 editor store；Session restore/switch
由 Host 关闭两个 gate，并在提交新 session generation 前事务性清除 Webview store；disposal 关闭
两个 gate。这些本地/事务性边界均不发送 editor `cleared`，Remove ack（若存在）可选且忽略。Host
在一个 owner queue 中先关 capture gate，再将规范化的 `staleReasons`（排序、去重的闭合集）与 Host
source fingerprint 组成 per-owner stale watermark；watermark 在分配 `eventSequence`/`requestId` 前判重。
首个 transition 只分配一对 ID 并投影一个 stale，重复/后续 transition 在该 owner 的 stale latch 下
不再分配或发送；新 ready owner 才重置 watermark。Webview 仍独立按完整同序 event 做 retransmission
dedup，并以 eventSequence 保证顺序。

Fence/correlation 也必须是公共契约：`viewGeneration` 在每次激活的第一个 view 从 `1` 开始并按
view 分配；`sessionGeneration` 每个 view 从 `0` 开始，只在 Host 接受 restore/selection commit、
Session switch 或 New chat 的新 owner 时递增；`cardGeneration` 在 `(viewGeneration, sessionGeneration)`
内从 `0` 开始，在每个新 card/owner invalidation 时递增；`eventSequence` 在 view 内从 `1` 开始，
每个 Host editor event 递增。四者都是非负 safe integer，递增前检查 `Number.MAX_SAFE_INTEGER`；
溢出 fail-closed，不回绕、不复用、不静默 reset，session/card/event 溢出要求新 view，view 溢出要求
新 activation。Host 为每个 outbound event 同步分配独立的 `requestId` 和 `eventSequence`；Webview
intent 的 `requestId` 是方向专属并按严格完整 payload 去重。事件严格携带
`protocolVersion,type,requestId,viewGeneration,sessionGeneration,eventSequence,status` 及状态所需的
`cardGeneration,captureId,contextId,scope,reason,context` 字段（详见 Protocol；`captureId` 仅适用于
ready/stale，cleared 不含该字段）。Capture fence 是
`(viewGeneration,sessionGeneration,captureId)`；Host active delivered-card owner tuple 严格为
`(viewGeneration,sessionGeneration,cardGeneration,contextId)`，`captureId` 仅作 capture correlation，
不进入 Webview intent tuple。Webview 对同序事件先做 canonical 完整字段比较：相同为 no-op，冲突丢弃；
随后仅更大 sequence 提交并推进 watermark，更小为 stale no-op。旧 tuple、跨 view/session、已关闭
gate、dispose 后事件均在 mutation 前拒绝。

### T1905 fencing and race matrix

实现和测试必须覆盖以下决定性矩阵；每个拒绝分支验证无文本分配、无模型/Tool/Approval、无持久化
变更和无迟到 Webview 事件：

| Race / boundary | Required order and result |
|---|---|
| command capture completes normally | capture gate open → one `ready` commit → owner gate opens; ready draft remains editable and Send is allowed |
| cancel/close before capture completion | capture gate closes first; completion is dropped; no `ready`, `stale`, `cleared`, retry, or unavailable result |
| editor/selection/document change with delivered card | close any capture gate → one current-owner `stale` with same card/context and `source.stale: true`; duplicate transition is a no-op |
| repeated identical editor/selection/document transition | normalize the same stale-reason set and source fingerprint before allocating IDs; one stale projection/`eventSequence`/`requestId` is emitted, repeats see the pending/committed watermark and emit nothing |
| setting disable, Trust loss, root/workspace change, unsupported editor with delivered card | close capture gate → one Host-driven current-owner `cleared`; owner gate closes; no later event is accepted |
| Remove or accepted New chat | Webview synchronously clears editor store, then sends one intent/action; Host closes matching gates and emits no editor `cleared`; no late event recreates a card |
| Host restore/session switch | Host closes both gates; Webview transactionally clears editor store before committing the new session generation; no editor `cleared` event or late result |
| view disposal | Webview is gone; Host closes both gates and emits no editor event; no post or live-region update |
| transition while capture is in flight and no delivered card | capture is cancelled; no stale/cleared event is emitted |
| Refresh A then Refresh B | A gate closes before B opens; late A result is dropped; only B can commit ready; prior delivered card remains until B ready |
| completion vs transition same turn | owner queue order decides: completion first commits ready then transition may stale/clear; transition first suppresses completion and emits no card event without an existing owner |
| old request/capture/context after newer ready | reject by captureId/cardGeneration/eventSequence; current card and draft are unchanged |
| cross-view or cross-session event | reject by viewGeneration/sessionGeneration before state mutation |
| duplicate/conflicting event or intent | Host transition watermark is checked before event-ID allocation; after delivery Webview compares canonical same-sequence payload before monotonic ordering: exact retransmission is a no-op, conflict is discarded; only greater sequence commits/watermarks, lower is stale no-op |
| event after disposal | reject by closed view gate; no post, live-region announcement, or focus change |
| `editorTextFocus` menu visible but Host cannot capture | return fixed `unavailable` code (`no-editor`, `unsupported-document`, `outside-workspace`, or `untrusted-workspace`); no fallback read |
| safe-integer fence overflow | fail closed before increment: no event, wrap, reuse, or silent reset; close affected gate and require a new view generation (view overflow requires a new activation) |

The focused tests must also assert command registration/menu enablement hints, setting default/disable
clearing, active-file versus exact-selection source/range, collapsed selection, ready-send/edit/remove,
stale blocking and Use-stale, focus preservation, Host-issued generation allocation/increment/reset,
safe-integer overflow fail-closed/new-view reset, strict DTO extra-field rejection including `captureId` only
on ready/stale and its omission on cleared, and Webview acceptance
of out-of-order, same-sequence compare-before-watermark duplicate/conflict, cross-view/session, post-refresh,
local/transactional clear without Host editor events, and post-disposal messages.

## 4. 阶段门禁

- 用户可以关闭编辑器上下文，且清楚看到上下文来源。
- 所有 URI 均经过 Host-owned 规范化和工作区范围验证。
- 诊断与语言服务均为只读、有界、可取消，不执行 Code Action 或产生写入。
- 工作区外、二进制、超限、陈旧和迟到结果均有确定性处理。
- 阶段完成后先用评测判断是否仍存在自建语义索引的真实需求。
