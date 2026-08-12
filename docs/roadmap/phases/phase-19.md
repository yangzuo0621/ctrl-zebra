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
  `cardGeneration`/`contextId`；旧请求、旧 `captureId`/`contextId`、已取消或已关闭的 view 均被
  Webview 忽略。
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
存在时，capture gate 关闭后才允许一次有界 stale（编辑器/选区/文档变化）或 cleared（设置/Trust/
工作区/不支持编辑器/Session/Remove/dispose）事件；没有已交付 card 时不得发送迟到 stale/cleared。
Host 在一个 owner queue 中先关 capture gate，再投影 transition，并以 eventSequence 保证顺序。

### T1905 fencing and race matrix

实现和测试必须覆盖以下决定性矩阵；每个拒绝分支验证无文本分配、无模型/Tool/Approval、无持久化
变更和无迟到 Webview 事件：

| Race / boundary | Required order and result |
|---|---|
| command capture completes normally | capture gate open → one `ready` commit → owner gate opens; ready draft remains editable and Send is allowed |
| cancel/close before capture completion | capture gate closes first; completion is dropped; no `ready`, `stale`, `cleared`, retry, or unavailable result |
| editor/selection/document change with delivered card | close any capture gate → one current-owner `stale` with same card/context and `source.stale: true`; duplicate transition is a no-op |
| setting disable, Trust loss, root/workspace change, unsupported editor, Session/New chat, Remove, dispose | close capture gate → one current-owner `cleared`; owner gate closes; no later event is accepted |
| transition while capture is in flight and no delivered card | capture is cancelled; no stale/cleared event is emitted |
| Refresh A then Refresh B | A gate closes before B opens; late A result is dropped; only B can commit ready; prior delivered card remains until B ready |
| completion vs transition same turn | owner queue order decides: completion first commits ready then transition may stale/clear; transition first suppresses completion and emits no card event without an existing owner |
| old request/capture/context after newer ready | reject by captureId/cardGeneration/eventSequence; current card and draft are unchanged |
| cross-view or cross-session event | reject by viewGeneration/sessionGeneration before state mutation |
| duplicate/conflicting event or intent | identical same-sequence payload is idempotent; same ID/sequence with different fields is rejected |
| event after disposal | reject by closed view gate; no post, live-region announcement, or focus change |
| `editorTextFocus` menu visible but Host cannot capture | return fixed `unavailable` code (`no-editor`, `unsupported-document`, `outside-workspace`, or `untrusted-workspace`); no fallback read |

The focused tests must also assert command registration/menu enablement hints, setting default/disable
clearing, active-file versus exact-selection source/range, collapsed selection, ready-send/edit/remove,
stale blocking and Use-stale, focus preservation, Host-issued generation allocation/increment/reset,
strict DTO extra-field rejection, and Webview acceptance of out-of-order, duplicate, conflicting,
cross-view/session, post-refresh, and post-disposal messages.

## 4. 阶段门禁

- 用户可以关闭编辑器上下文，且清楚看到上下文来源。
- 所有 URI 均经过 Host-owned 规范化和工作区范围验证。
- 诊断与语言服务均为只读、有界、可取消，不执行 Code Action 或产生写入。
- 工作区外、二进制、超限、陈旧和迟到结果均有确定性处理。
- 阶段完成后先用评测判断是否仍存在自建语义索引的真实需求。
