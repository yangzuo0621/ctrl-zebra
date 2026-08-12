# CtrlZebra 工程机会台账

## 1. 目的与权限

本台账记录尚未获准实施的复用、模块深化、依赖引入和重复消除机会，使发现不会丢失，也不会
借“清理”绕过任务范围。它只拥有候选项的证据、评估和处置；不拥有路线图顺序、任务状态、
产品语义、公共契约或技术基线。

- `EO-*` 是稳定的机会编号，不是路线图任务编号，也不代表已经授权。
- 候选项只有在明确批准后，才进入一个路线图任务或独立 maintenance 变更。
- 需要跨会话跟踪、依赖评审、多 PR 或外部讨论的独立变更，在实施前创建 GitHub Issue，并从
  本台账链接；可在一次已授权会话中完成的小型 maintenance 可以直接使用任务计划。
- 晋升后的执行顺序和状态只记录在 `docs/implementation-plan.md` 或对应 Issue/PR；本台账只
  保留链接和最终处置，避免形成第二套任务状态。
- 发现不在当前范围内的机会时，只更新本台账，不顺带实现。

## 2. 状态与晋升流程

| 状态 | 含义 |
|---|---|
| `已发现` | 有初步重复或 Build vs Buy 证据，尚未完成方案评估 |
| `评估中` | 已确定候选 seam、替代方案和主要风险，等待决策或验证 |
| `待晋升` | 方案已足够具体，等待明确授权进入路线图任务或 maintenance |
| `已晋升` | 已有正式任务、Issue 或 PR；执行状态由该记录拥有 |
| `已完成` | 晋升项已合入，旧实现和本台账要求的遗留均已处置 |
| `暂缓` | 当前没有足够收益、证据或合适窗口；保留重新评估触发条件 |
| `拒绝` | 已决定不实施，并记录原因 |

晋升一个机会时：

1. 重新验证证据仍存在，确认没有被当前路线图任务吸收。
2. 按 `docs/roadmap/task-template.md` 完成 Reuse Audit、Build vs Buy 和 Similarity Audit 计划。
3. 明确一个拥有语义的 module、最小 interface、调用方错误映射和删除目标。禁止把共享逻辑放入
   仓库级 `utils`，也禁止在旧实现外增加无行为的转发层。
4. 判断它是路线图能力、独立 maintenance，还是现有任务的验收内容。涉及任务顺序、技术基线、
   公共契约或模块方向时，先执行变更控制。
5. 只晋升一个可独立验证的 tranche。实施完成后，在本台账记录链接和处置结果。

所有替换类机会共享一个完成门禁：新 interface 获得等价行为覆盖后，必须删除被取代的实现和
只服务于旧实现的测试；不得保留新旧双路径、兼容性影子实现或纯转发包装。

## 3. 候选组合与建议窗口

下表的窗口是规划建议，不改变当前执行点；T2001 仍需单独授权。

| 机会 | 类型 | 优先级 | 建议窗口或依赖 | 状态 |
|---|---|---:|---|---|
| [EO-001 Provider endpoint policy](#eo-001-provider-endpoint-policy) | 深化 | P0 | 首个独立 maintenance 窗口 | `已晋升` |
| [EO-002 Extension test support](#eo-002-extension-test-support) | 复用 | P1 | EO-003、EO-004 前 | `已晋升` |
| [EO-003 IDE source projection](#eo-003-ide-source-projection) | 深化 | P1 | EO-002 后；新增 IDE 投影前 | `已晋升` |
| [EO-004 Bounded text persistence](#eo-004-bounded-text-persistence) | 深化 | P1 | EO-002 后；Phase 21 数据控制前优先评估 | `已晋升` |
| [EO-005 MCP catalog refresh](#eo-005-mcp-catalog-refresh) | 深化 | P1 | MCP 再次演进或独立 maintenance 窗口 | `评估中` |
| [EO-006 MCP error ownership](#eo-006-mcp-error-ownership) | 深化 | P2 | EO-005 后；需要契约影响确认 | `已发现` |
| [EO-007 Package-local text primitives](#eo-007-package-local-text-primitives) | 复用 | P2 | EO-003、EO-004 后；每次只处理一个 package | `已发现` |
| [EO-008 Safe regex engine](#eo-008-safe-regex-engine) | Buy | P0 | 纳入 T2001 决策、T2005 实施，不单独插队 | `评估中` |
| [EO-009 Markdown renderer](#eo-009-markdown-renderer) | Buy re-evaluation | P3 | 先证明净收益并通过基线变更控制 | `暂缓` |
| [EO-010 Targeted Zod reuse](#eo-010-targeted-zod-reuse) | 已有依赖复用 | P2 | 随拥有 schema 的任务分 tranche | `已发现` |
| [EO-011 Provider token counting](#eo-011-provider-token-counting) | Buy / 实验 | P3 | 先有准确度或预算缺陷数据 | `暂缓` |

建议的依赖链是：

```text
EO-002 ──→ EO-003
   └─────→ EO-004 ──→ EO-007

T2001 decision ──→ EO-008 evidence ──→ T2005 implementation

EO-005 ──→ EO-006
```

EO-001 可以独立进行。EO-009 和 EO-011 不应阻塞 Phase 20–22。

## 4. 重复消除机会

### EO-001 Provider endpoint policy

- **执行记录**：[EO-001 maintenance record](maintenance/EO-001-provider-endpoint-policy.md)

- **问题证据**：`apps/extension/src/adapters/provider-configuration.ts` 与
  `apps/extension/src/controllers/provider-connection-check-command.ts` 分别维护 loopback 和 endpoint
  判定。
- **目标 seam**：Extension-private `provider-endpoint-policy` module；调用方保留各自的诊断和 UI
  错误映射。
- **Build vs Buy**：优先深化本地 module。逻辑较小且承载产品安全策略，引入依赖没有足够收益。
- **验收**：两条调用路径通过同一 policy interface；安全边界测试覆盖允许、拒绝和规范化失败；
  删除两处旧判定及其实现专用测试；不改变配置或命令契约。
- **规模与风险**：小；安全敏感，必须独立审查。

### EO-002 Extension test support

- **问题证据**：Extension 测试中存在多份 `TestUri`，Webview 测试也重复维护 host fake。
- **目标 seam**：分别在 `apps/extension/src/test/support/` 和 Webview 私有测试支持目录建立最小
  fixture interface；不扩大 `packages/testkit` 的依赖方向。
- **Build vs Buy**：直接复用仓库内测试支持；无需运行时依赖。
- **验收**：迁移调用方后删除重复 fake 及实现专用测试；fixture 不承载生产策略、不导出到公共
  package entry point；测试行为和失败可读性保持不变。
- **规模与风险**：小；是 EO-003、EO-004 的迁移前置。

### EO-003 IDE source projection

- **问题证据**：`vscode-diagnostics.ts`、`vscode-language-services.ts` 和
  `vscode-editor-context.ts` 重复组合 URI identity、相对路径、Unicode position、range 排序与
  UTF-8/code-point 投影。
- **目标 seam**：Extension-private `IdeSourceProjector` deep module，以小 interface 隐藏
  URI/text/range 投影算法；三个 adapter 只保留来源采集和调用方错误映射。
- **Build vs Buy**：先评估 VS Code API 和现有 module；产品投影语义保留自有。只有通用 Unicode
  算法无法由平台可靠提供时，才单独评估库。
- **验收**：契约测试覆盖 ASCII、surrogate pair、多字节字符、边界 range、不同 URI scheme 和
  排序；三个 adapter 的等价逻辑全部删除；不得新增公共 package 或仓库级文本工具箱。
- **规模与风险**：大；应拆成一个行为锁定 tranche 和一个调用方迁移 tranche，但同一时间只执行
  一个获准变更。

### EO-004 Bounded text persistence

- **问题证据**：`vscode-session-storage.ts` 与 `vscode-checkpoint-storage.ts` 重复实现路径段校验、
  URI resolve、父目录创建、bounded UTF-8 read/write、FileNotFound、delete 和 rename。
- **目标 seam**：Extension-private `VscodeBoundedTextStorage` deep module；Session 和 Checkpoint
  module 继续拥有原子性、恢复、兼容性和领域错误。
- **Build vs Buy**：优先深化 VS Code adapter；VS Code API 已提供底层文件能力，不引入新的文件
  系统库。
- **验收**：共享 interface 的契约测试覆盖大小上限、缺失文件、非法路径、原子替换失败和清理；
  两个调用方旧 I/O 实现及其专用测试被删除；不得弱化 persistence 或 checkpoint 规则。
- **规模与风险**：中到大；在 Phase 21 会话数据控制开始前重新评估，可减少后续第三份实现。

### EO-005 MCP catalog refresh

- **问题证据**：`packages/mcp-client/src/controlled-mcp-client.ts` 的 Tool、Prompt、Resource 刷新
  分支重复维护分页 cursor、上限、并发合并、generation fencing 和 `AbortSignal`。
- **目标 seam**：package-private pagination collector 加一个拥有刷新生命周期的 catalog module；
  Tool policy 继续拥有 schema 拒绝、撤销和诊断语义。
- **Build vs Buy**：先深化现有 MCP module。SDK 可提供 transport 和 DTO，但不能接管 CtrlZebra
  的 stale fencing、budget、cancellation 和错误语义。
- **验收**：三类 catalog 共享分页与 refresh interface；覆盖重复 cursor、越界页、取消、并发刷新、
  stale completion 和部分失败；删除三份等价控制流，不保留转发壳。
- **规模与风险**：中；生命周期敏感。

### EO-006 MCP error ownership

- **问题证据**：`packages/mcp-client/src/errors.ts` 与 Extension 的
  `apps/extension/src/controllers/mcp-connection-controller.ts` 同时维护部分 client error 文案。
- **目标 seam**：MCP client 拥有 client code 与规范化信息，Extension 只拥有 host/process/config
  错误和展示映射。
- **Build vs Buy**：深化现有错误 module，不引入依赖。
- **验收**：先确认公共 entry point 和稳定错误契约影响；删除 Extension 中等价 client 映射；测试
  分别锁定 client normalization 和 host-only mapping。
- **规模与风险**：小到中；若改变公共契约，必须先执行变更控制。

### EO-007 Package-local text primitives

- **问题证据**：多个 package 内散布 `utf8ByteLength`、code-point byte count、`isRecord`、URI
  比较和 canonical JSON 等小型实现。
- **目标 seam**：只在语义拥有者明确的 package 内复用；优先让 EO-003、EO-004 的 deep module
  吸收相关逻辑，再判断剩余第二份实现是否值得提取。
- **Build vs Buy**：标准库或现有 Zod/schema 优先；禁止建立跨仓库 `text-utils` 或 `common`。
- **验收**：每个获准 tranche 只处理一个 package 和一种语义；列出删除位置；调用者需要不同错误
  时使用映射；没有证据证明相同语义的实现保持分离并记录原因。
- **规模与风险**：每 tranche 小；整体不得作为一次全仓机械重构。

## 5. Build vs Buy 机会

### EO-008 Safe regex engine

- **路线图关系**：T2001 应先决定允许的 regex 语法、安全界限和失败契约；T2005 才实现受控 regex
  搜索。本机会不创建插队任务。
- **候选机制**：优先评估纯 JavaScript `re2js`。当前公开资料描述其为 RE2/RE2J 的 JavaScript
  port，目标是线性时间匹配；其 RE2 语法与 JavaScript `RegExp` 不完全相同，因此不能只替换构造器。
- **初筛资料**：[`re2js` npm metadata](https://www.npmjs.com/package/re2js)、
  [`re2js` repository](https://github.com/le0pard/re2js) 和
  [RE2 syntax](https://github.com/google/re2/wiki/Syntax)。
- **必须补齐的证据**：精确版本、维护活跃度、许可证、包体和 VSIX 影响、ESM/CJS 兼容、Unicode
  行为、pattern/input/memory 上限、取消粒度、语法差异和恶意输入 benchmark。Context7 未收录
  `re2js` 的直接文档，实施时必须以项目仓库、发布包和安全测试重新核实。
- **目标 seam**：Builtin Tool 或 Extension host 拥有的 controlled regex interface；第三方 pattern、
  match、failure 类型不得进入 Protocol 或 Core 契约。
- **验收**：T2001 记录 adopt/reject 及替代方案；若 adopt，T2005 同时删除任何被取代的自制 parser、
  guard 或执行路径，并以 adversarial tests 证明界限。

### EO-009 Markdown renderer

- **当前判断**：暂缓。项目已经使用并固定 `markdown-it`，自维护的是受限 Markdown token 到
  React tree 的映射和产品安全策略；这不是“没有买现成”的直接案例。
- **候选机制**：只有在当前 mapping 成本继续增长时才重新评估 `react-markdown`。其当前 interface
  支持 custom components、URL transform 和 remark plugins；raw HTML 需要显式 plugin，但这些
  能力本身不足以证明替换现有依赖有净收益。
- **初筛资料**：[`react-markdown` repository and documentation](https://github.com/remarkjs/react-markdown)。
- **目标 seam**：Webview-private renderer adapter 继续拥有 bounded prefix、元素 allowlist、自定义
  link、复制交互和错误降级；库只拥有 Markdown AST/渲染机制。
- **必须补齐的证据**：与当前 renderer 的 corpus differential tests、GFM 范围、bundle/VSIX 影响、
  React/Vite 兼容、依赖树、许可证、恶意 URL/HTML 行为，以及删除自有代码减去新增 adapter 与
  依赖复杂度后的净维护收益。替换会改变当前技术基线，必须先执行变更控制。
- **验收**：等价覆盖后删除手写 token-to-tree pipeline 和只服务于它的测试；保留行为级 corpus，
  不保留双 renderer fallback。

### EO-010 Targeted Zod reuse

- **问题证据**：仓库已使用 Zod，但部分 `unknown` 输入仍由重复的 record/field parser 验证。
- **候选机制**：优先复用 Protocol 已拥有的 schema，或在实际拥有输入语义的 package 内定义 schema；
  不进行全仓“一次性 Zod 化”。
- **目标 seam**：schema 负责结构验证，调用 module 继续负责预算、授权、状态和稳定错误映射。
- **验收**：每个 tranche 证明 schema 是单一事实源，删除被取代的 parser 和实现专用测试，保留
  public/error compatibility tests；不得为方便而改变允许的输入或 package 依赖方向。

### EO-011 Provider token counting

- **当前判断**：暂缓。`gpt-tokenizer` 提供 OpenAI model/encoding 级计数，但不能准确代表 Gemini
  或任意 OpenAI-compatible provider；全局采用会制造错误的产品语义。
- **初筛资料**：[`gpt-tokenizer` repository and documentation](https://github.com/niieani/gpt-tokenizer)。
- **重新评估触发**：真实数据证明当前估算导致显著 context 浪费、拒绝或溢出，且 provider adapter
  能为已知模型选择可信 encoding。
- **目标 seam**：Core 只依赖注入的 token-counting interface；Provider adapter 可选使用库，未知
  模型保留明确的 bounded fallback 和可观测误差。
- **必须补齐的证据**：模型覆盖、版本漂移策略、bundle/启动成本、离线行为、准确度 corpus 和
  provider-specific failure mapping。未达到触发条件前不创建依赖 PR。

## 6. 处置记录

晋升或关闭机会时追加一行；不要在上方复制正式任务状态。

| 日期 | 机会 | 处置 | 正式记录 | 说明 |
|---|---|---|---|---|
| 2026-08-12 | EO-003 IDE source projection | 独立 maintenance 已完成 | [EO-003 maintenance record](maintenance/EO-003-ide-source-projection.md)；[PR #217](https://github.com/yangzuo0621/ctrl-zebra/pull/217) | Projector 契约、三处 adapter 迁移及全套验证已完成；Task-reviewer 已批准，PR 通过 CI 后按 reviewed squash flow 合入。 |
| 2026-08-12 | EO-001–EO-011 | 初始登记 | — | 来自 Phase 19 后的重复实现与 Build vs Buy 审查 |
| 2026-08-12 | EO-001 | 已晋升为独立 maintenance | [EO-001 maintenance](maintenance/EO-001-provider-endpoint-policy.md) / [PR #215](https://github.com/yangzuo0621/ctrl-zebra/pull/215) | 在最新 `origin/main` 上重新验证两处重复 endpoint/loopback 判定后建立 Extension-private policy seam |
| 2026-08-12 | EO-002 | 已晋升为独立 maintenance | [EO-002 maintenance](maintenance/EO-002-extension-test-support.md) | 在最新 `origin/main` 上重新验证六份 Extension `TestUri` 与两份 Webview host fake 后建立两个 application-private test-support seam |
| 2026-08-12 | EO-004 | 已晋升为独立 maintenance | [EO-004 maintenance](maintenance/EO-004-bounded-text-persistence.md) | 在最新 `origin/main` `6ef3a3b` 上重新验证 Session/Checkpoint 的重复 bounded text I/O 后建立 Extension-private `VscodeBoundedTextStorage` seam |
