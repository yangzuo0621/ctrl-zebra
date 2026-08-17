# CtrlZebra 工程机会台账

## 1. 目的与权限

本台账记录尚未获准实施的复用、模块深化、依赖引入和重复消除机会，使发现不会丢失，也不会
借“清理”绕过任务范围。本文件只拥有机会状态、评估门禁和下一评估窗口；maintenance 记录与 PR
保存已完成的决策、执行证据和验证结论；`docs/implementation-plan.md` 只拥有路线图顺序、任务状态
和完成引用。它不拥有产品语义、公共契约或技术基线。

- `EO-*` 是稳定的机会编号，不是路线图任务编号，也不代表已经授权。
- 候选项只有在明确批准后，才进入一个路线图任务或独立 maintenance 变更。
- 需要跨会话跟踪、依赖评审、多 PR 或外部讨论的独立变更，在实施前创建 GitHub Issue，并从
  本台账链接；可在一次已授权会话中完成的小型 maintenance 可以直接使用任务计划。
- 晋升后的执行顺序和状态只记录在 `docs/implementation-plan.md` 或对应 Issue/PR；maintenance
  记录和 PR 是已完成决策与执行证据的来源，本台账只保留入口、状态和最终处置，避免形成第二套任务状态。
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

下表只列仍未完全处置、需要后续评估或明确窗口的机会；已晋升/已完成项目移入第 4 节台账。窗口
是规划建议，不改变当前执行点。

| 机会 | 类型 | 优先级 | 建议窗口或依赖 | 状态 |
|---|---|---:|---|---|
| [EO-009 Markdown renderer](#eo-009-markdown-renderer) | Buy re-evaluation | P3 | 先证明净收益并通过基线变更控制 | `暂缓` |
| [EO-010 Targeted Zod reuse](#eo-010-targeted-zod-reuse) | 已有依赖复用 | P2 | 随拥有 schema 的任务分 tranche | `已发现` |
| [EO-011 Provider token counting](#eo-011-provider-token-counting) | Buy / 实验 | P3 | 先有准确度或预算缺陷数据 | `暂缓` |
| [EO-012 MCP SDK-native negotiation](#eo-012-mcp-sdk-native-negotiation) | Buy / 已有依赖深化 | P0 | MCP 再次演进前优先评估；不阻塞后续路线图 | `评估中` |

仍影响未来执行的关系是：

```text
EO-012 evidence ──→ independent maintenance decision
```

EO-012 可独立评估；除非发现当前 negotiation 存在实际缺陷，否则不阻塞路线图推进。
EO-009 和 EO-011 不应阻塞 Phase 22 收尾。若验证 SDK-native negotiation 能保持现有安全语义，再晋升为
独立 maintenance。

## 4. 已晋升/已完成台账

EO-001–EO-008 的技术决策、执行证据和逐项验证以各自 maintenance 记录为准。本表只保留每项的最终
状态、长期 owner/结论和入口；PR 链接仅在现有记录明确存在时列出，未创建或未推送的 PR 不补造。
问题证据、候选比较、迁移步骤和执行流水不在本文件重复。

| 机会 | 最终状态 | 长期 owner / 结论 | Maintenance / PR |
|---|---|---|---|
| EO-001 Provider endpoint policy | `已晋升` | Extension-private endpoint policy 拥有 normalization、loopback 与 credential 语义；调用方保留诊断和 UI 映射。 | [maintenance](maintenance/EO-001-provider-endpoint-policy.md)；[PR #215](https://github.com/yangzuo0621/ctrl-zebra/pull/215) |
| EO-002 Extension test support | `已晋升` | Extension URI fixture 与 Webview host fixture 仅供测试使用；不扩大公共 package 或生产策略。 | [maintenance](maintenance/EO-002-extension-test-support.md)；[PR #216](https://github.com/yangzuo0621/ctrl-zebra/pull/216) |
| EO-003 IDE source projection | `已完成` | Extension `IdeSourceProjector` 拥有 URI/path、Unicode/UTF-8、range/order 与 truncation 投影；adapters 保留来源和错误映射。 | [maintenance](maintenance/EO-003-ide-source-projection.md)；[PR #217](https://github.com/yangzuo0621/ctrl-zebra/pull/217) |
| EO-004 Bounded text persistence | `已晋升` | Extension `VscodeBoundedTextStorage` 拥有 bounded persistence I/O；Session/Checkpoint 保留领域行为、原子性、恢复和兼容性。 | [maintenance](maintenance/EO-004-bounded-text-persistence.md)；[PR #218](https://github.com/yangzuo0621/ctrl-zebra/pull/218) |
| EO-005 MCP catalog refresh | `已晋升` | package-private collector 与 refresh lifecycle 拥有分页、generation 与 cancellation 复用；Tool/Prompt/Resource policy 保留 schema、撤销和诊断。 | [maintenance](maintenance/EO-005-mcp-catalog-refresh.md)；[PR #220](https://github.com/yangzuo0621/ctrl-zebra/pull/220) |
| EO-006 MCP error ownership | `已完成` | MCP client 拥有稳定 client error normalization；Extension 保留 Host/process/configuration fallback 与展示映射。 | [maintenance](maintenance/EO-006-mcp-error-ownership.md)；[PR #221](https://github.com/yangzuo0621/ctrl-zebra/pull/221) |
| EO-007 Package-local text primitives | `已完成` | 各 package 按语义拥有 text/record/URI/canonical JSON/equality seam；不建立跨包 `text-utils` 或 `common`。 | [maintenance](maintenance/EO-007-package-local-text-primitives.md)；[PR #222](https://github.com/yangzuo0621/ctrl-zebra/pull/222)，merged commit `53bc57b` |
| EO-008 Safe regex engine | `已完成` | `packages/builtin-tools` 的 package-local controlled RE2JS adapter 拥有 RE2-compatible syntax filtering, bounded program/input/aggregate budgets, cancellation and empty-match policy, and stable `invalid-input` mapping; RE2JS types and failures remain private. | [PR #235](https://github.com/yangzuo0621/ctrl-zebra/pull/235) |

## 5. Build vs Buy 机会

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

### EO-012 MCP SDK-native negotiation

- **问题证据**：`packages/mcp-client/src/mcp-negotiation.ts` 当前自行实现 MCP modern-first 协商，
  包括 `server/discover` probe、JSON-RPC request/reply 分类、超时、modern/legacy 判定、
  UnsupportedProtocolVersion 处理、DiscoverResult 与 capability 结构校验，以及 probe transport
  handler 的临时接管。当前 `ControlledMcpClient.connect()` 先调用 package-owned
  `negotiateMcpEra()`，再通过 `Client.connect(..., { prior })` 把协商结果交给
  `@modelcontextprotocol/client`。仓库已经固定使用 `@modelcontextprotocol/client@2.0.0`，且
  `sdk-options.ts` 已配置 SDK 的 `versionNegotiation`，因此应重新评估自研协议协商层是否仍有必要。
- **候选机制**：优先评估 `@modelcontextprotocol/client` v2 原生 version negotiation / probe
  classification 能力，让 SDK 拥有 MCP wire-level 协议协商，CtrlZebra 仅保留产品级安全与生命周期
  策略。不新增第二个 MCP library，不自行维护 SDK 已正式提供的协议状态机。
- **目标 seam**：`ControlledMcpClient` 继续拥有 Host-owned process / stdio transport 生命周期、
  startup approval 与 Workspace Trust、generation fencing、cancellation 与 stale completion 拒绝、
  bounded stderr / cleanup、termination confirmation、CtrlZebra 稳定错误映射与连接状态投影。
  MCP SDK 应尽可能拥有 `server/discover` wire protocol、protocol-version negotiation、
  UnsupportedProtocolVersion 处理、modern negotiation DTO / protocol validation，以及 SDK 已正式定义的
  negotiation failure taxonomy。SDK 原生类型、异常和 negotiation DTO 不得直接泄漏进入 Core、
  Protocol 或 Webview 公共契约。
- **Build vs Buy**：优先深化现有 `@modelcontextprotocol/client` 依赖，而不是继续维护
  CtrlZebra-private protocol negotiation implementation。只有 differential validation 证明 SDK 无法
  表达 CtrlZebra 已固定的 modern-only / dual downgrade 安全语义，或无法维持 bounded / deterministic
  failure classification 时，才保留自研 negotiation seam。
- **必须补齐的证据**：
  1. 核实当前固定 SDK 版本的 public API，而不是依据 unreleased/internal API。
  2. 建立现有 `negotiateMcpEra()` 与 SDK-native negotiation 的 differential corpus。
  3. 覆盖 modern success、unsupported requested version、legacy server、timeout、malformed result、
     unknown JSON-RPC error、server exit、abort 和 stale generation。
  4. 明确 SDK 对 modern-only 与 dual compatibility mode 的真实行为。
  5. 验证 `supportedVersions`、capabilities、DiscoverResult 等结构校验是否由 SDK 完整拥有；不能因减少
     代码而放宽当前安全边界。
  6. 核实 transport 是否仍可保持 CtrlZebra-owned process termination、stderr bounds 和 delivery gate。
  7. 比较 bundle / VSIX、类型复杂度、测试量和最终删除的净代码量。
- **预期删除目标**：若采用 SDK-native negotiation，应删除 `mcp-negotiation.ts` 中已由 SDK 等价拥有的
  probe / classifier / protocol DTO validation、只服务于上述实现的 package-private helper、只验证被删除
  内部算法而非产品行为的 implementation-specific tests，以及 `Client.connect(..., { prior })` 前为了绕过
  SDK negotiation 而存在的 glue code。不得长期保留“SDK negotiation + 自研 negotiation”双路径或
  fallback shadow implementation。
- **验收**：公共 MCP connection / error / capability 契约不变，除非先完成正式变更控制；modern-only
  不发生未授权 legacy downgrade；dual mode 的 downgrade 条件不比当前实现更宽松；malformed、timeout、
  abort、stale-generation 和 transport failure 行为具有等价或更严格的测试覆盖；process cleanup 和
  termination confirmation 仍由 CtrlZebra Host boundary 拥有；differential tests 全部通过后删除被取代
  实现，不保留双路径；全量 MCP unit、Extension integration、VSIX smoke tests 通过。
- **规模与风险**：中到大；协议和兼容性敏感，但净删除潜力较高。应先做独立 investigation / proof
  tranche，再决定是否晋升为 maintenance。
