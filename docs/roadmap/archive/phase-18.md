# 阶段 18：MCP Schema 与双纪元兼容性

> **归档状态：阶段性归档校验通过**
>
> - 归档日期：2026-08-12
> - 完成任务：T1801–T1807；任务实现已通过 PR #188、#191、#193、#195、#197、#198、#199 合并到 `main`。
> - 归档基线：`d261a754693420ff62bfa02c418183933ae9f416`（`main` 与 `origin/main` 一致且工作区 clean）。
> - 归档 PR：[ #200](https://github.com/yangzuo0621/ctrl-zebra/pull/200)（待审阅与 squash 合并）。
> - 阶段门禁：单工具 Schema 隔离、危险/未知 Schema 拒绝、递归引用一致性、稳定诊断、双纪元闭合集、modern-first 无误回退、统一审批/Trust/generation/资源/清理边界，以及 Server-to-Client 请求前置拒绝均已由实现、协议 Schema、领域文档和测试覆盖。
> - 跨边界一致性：`docs/architecture.md`、`docs/security.md`、`docs/protocol.md`、`docs/persistence.md`、`docs/ux.md`、`docs/webview.md`、`docs/configuration.md`、README、ADR 0001 补充说明与 ADR 0002 的模式、版本、错误、持久化和排除项一致。
> - 验证证据：`pnpm check`（345 files）、`pnpm typecheck`、`pnpm test:unit`（130 files/1585 tests）、`pnpm build`、`pnpm test:integration`、`pnpm package:vsix` 和针对该 commit 的 `pnpm smoke:vsix` 均通过。VSIX 为 12 个 allowlisted entries（807093 compressed bytes、3667482 uncompressed bytes）；README/license parity、fixture/credential/network 排除和无 fixture 入包由 packaging verifier 与 fixture 审计确认。
> - 后续门禁：归档 PR 合并前不得开始 T1901；归档后执行点为 T1901。

## 1. 阶段目标

在不放宽危险 Schema、审批或资源边界的前提下，把 MCP Tool 发现从“一个工具失败导致整个目录
不可用”改为单工具降级，并为本地 stdio Server 提供用户显式选择的 modern-only/dual 协议模式。

## 2. 前置条件与固定范围

- 阶段 17 已完成；阶段 14 的安全与协议契约继续有效。
- Schema 线 T1801–T1803 继续使用 MCP `2026-07-28` 精确版本，不依赖双纪元实现。
- T1801 必须先更新 `docs/architecture.md`、`docs/security.md`、`docs/protocol.md` 和 ADR 0001 的
  补充说明；约束 PR 合入后才能实现。
- [ADR 0002](../../adr/0002-mcp-dual-era-stdio-compatibility.md) 已批准双纪元方向。T1804 必须先把
  modern-only/dual 配置、探测、回退、能力、持久化和 UX 契约写入全部权威领域文档，约束 PR
  合入后才能实现 T1805–T1807。
- 所有 MCP Server 描述、Schema、错误和工具名称继续视为不可信并受硬上限。

双纪元首期只支持本地 stdio、modern `2026-07-28` 与 legacy `2025-11-25` 的闭合集。旧于
`2025-11-25`、未知未来版本、Streamable HTTP、旧 HTTP+SSE、OAuth、远程/多 Server、自动连接、
自动重启和新增 Client 原语明确排除。服务器发起的 Roots、Sampling、Elicitation、Tasks 或其他
未授权请求必须被有界拒绝，不能到达 Core、Provider、Workspace、审批或持久化。

## 3. 任务

### T1801：建立单工具失败隔离与拒绝投影

定义并实现 Tool 级接受/拒绝结果、枚举化原因和有界 `rejectedTools` 投影。一个工具不合规不得移除
同目录其他有效工具；目录更新仍须原子且防止陈旧世代覆盖。

测试全有效、单个失败、全部失败、重复名称、分页、列表刷新、断开竞态、拒绝列表上限和旧客户端
不理解新投影时的兼容行为。

### T1802：细化 Schema 关键字分类与引用规则

把关键字分为允许、可安全剥离、必须拒绝和未知拒绝四类；危险正则、远程引用、超限结构和未审查
未知关键字继续失败。明确 `definitions` 到 `$defs` 的受控转换，以及直接自引用和互相引用的真实
契约。不得因为“生态兼容”跳过 Ajv 编译或参数运行时校验。

测试常见生成器 Schema、危险正则、远程 `$ref`、深度/节点/字节上限、递归、互相引用、Draft
差异、剥离后语义和模型参数校验。

### T1803：提供精准的 MCP 失败诊断

在 MCP 面板显示被跳过的工具、稳定原因和可操作恢复提示；不展示原始第三方错误、无限 Schema、
命令、环境或敏感数据。协议不兼容提示说明已配置模式、受支持闭合集和下一步，但不得在连接完成前
把探测或回退描述为成功。

测试错误分类、截断、去重、刷新恢复、无敏感值、键盘/屏幕阅读器和普通连接路径回归。

### T1804：固化双纪元跨边界契约与配置迁移

根据 ADR 0002 更新 `docs/architecture.md`、`docs/security.md`、`docs/protocol.md`、
`docs/persistence.md`、`docs/ux.md`、`docs/webview.md`、README 和配置说明；定义用户可见的
`modern-only | dual` 模式、现有配置保持 modern-only、新配置迁移、negotiated era/version DTO、
稳定错误、持久化 provenance 和回退状态不可见边界。

约束 PR 合入后实现配置/Protocol Schema 与兼容 fixture；不得在该 PR 中实现 SDK 生命周期。

测试旧配置、显式 dual、未知模式、严格 Schema、连接状态组合、恢复投影、版本闭合集和额外字段拒绝。
兼容 fixture/test 还必须固定唯一错误映射：语法/结构错误或响应/错误形状校验失败为
`malformed-message`；结构有效但不属于闭合 recognized-modern/defined-non-modern 分类（含未知未来或
未分类值）为 `protocol-incompatible`；两者均不得触发回退。Fixture 不访问网络、不含真实凭据且不进入发布产物。

### T1805：实现 stdio 双纪元探测与协商

在 `packages/mcp-client` 内实现官方 modern-first 算法：一次有界 `server/discover`；DiscoverResult 或
可识别 modern 错误锁定 modern；只有规范允许的非 modern 结果或超时才能在 dual 模式进入一次
legacy `initialize` / `notifications/initialized`。取消、malformed、超限、进程退出、Trust 失效和
清理失败不得触发回退；迟到 probe 结果受 generation gate 丢弃。

测试 modern 成功、modern 错误选择版本、modern 不兼容不回退、legacy 超时回退、非 modern 错误
回退、语法/结构错误或校验失败映射 `malformed-message` 且不回退、结构有效的未知未来/未分类值映射
`protocol-incompatible` 且不回退、取消、迟到响应、重复协商、进程退出和 closed version set。

### T1806：完成 legacy 安全矩阵与 Server 请求拒绝

验证 legacy 下的 Tools、Resources、Prompts、list-changed、取消、分页和结果限额与 modern 使用同一
CtrlZebra 边界；对 Roots、Sampling、Elicitation、Tasks、logging、completion 和未知 Server 请求
提供有界拒绝，绝不调用模型、读取工作区、请求审批或持久化请求内容。

测试每类未声明请求、请求/响应竞态、断开、取消、通知风暴、Tool 审批、Resource/Prompt 注入、
`input_required`、超限和完整进程树清理。

### T1807：接入 Extension、Webview、持久化与端到端证据

Extension 根据用户配置选择模式并发布 negotiated era/version；Webview 清楚展示 configured mode、
实际 era 和兼容错误；持久化只记录有界 provenance，不在恢复时重连或重新协商；README 和排障文档
覆盖 modern-only、dual、受支持版本和显式限制。

使用受控 modern、legacy 和 malformed fixture Server 完成单元、Extension 集成和 VSIX smoke；
fixture 不访问网络、不含真实凭据且不进入发布产物。

## 4. 阶段门禁

- 单个不兼容 Schema 不再使其他有效工具不可用。
- 危险关键字、远程引用、资源超限和未知关键字仍然拒绝。
- 文档、ADR 补充说明、实现和测试对递归引用行为一致。
- 用户能识别被拒工具及稳定原因，诊断不泄漏原始不可信数据。
- modern-only 继续只接受 `2026-07-28`；dual 只接受 `2026-07-28` 和 `2025-11-25`。
- 可识别 modern 响应、malformed、超限、取消、进程退出和清理失败绝不触发 legacy 回退。
- 两个纪元使用同一启动批准、Tool 审批、Workspace Trust、generation、取消、资源限额和清理边界。
- 所有未授权 Server-to-Client 请求在 Core、Provider、Workspace、审批和持久化之前被拒绝。
