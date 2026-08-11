# 阶段 16：Provider 上手体验

## 1. 阶段目标

让三个已支持 Provider 都能通过产品内入口完成最小配置，避免默认 Provider 因没有密钥保存或模型
选择入口而不可用。

## 2. 前置条件与范围

- 阶段 15 已完成。
- 继续只支持现有 OpenAI、Gemini 和 OpenAI-compatible Provider，不新增 Provider。
- Secret 只进入 Extension-owned `SecretStorage`，绝不进入 Webview、配置、日志或持久化。
- 涉及 SDK/API 的任务开始前，按 `AGENTS.md` 使用 Context7 核对当前官方文档。

本阶段不包含账户登录、OAuth、密钥同步、Provider 配置面板、模型基准测试、自动选择模型或价格查询。
能力检查不承诺推断 Provider 未公开的模型属性，也不发送工作区、会话或 Tool 内容。

## 3. 任务

### T1601：补齐三个 Provider 的密钥保存入口

泛化现有安全输入与 SecretStorage 流程，注册可发现命令并同步 README。测试命令注册、遮蔽输入、
取消、空值、覆盖确认、SecretStorage 失败和日志/消息不泄密。

### T1602：实现最小模型选择与手工降级

先在 `docs/security.md`、`docs/protocol.md`、`docs/ux.md` 和隐私说明中确定网络、配置和错误边界。
实现用户触发的模型选择；只有官方 API 文档证明稳定且安全时才拉取列表，否则提供手工输入。
列表请求不携带工作区、会话或 Tool 内容，失败不得破坏现有配置。

测试正常选择、空列表、网络失败、无密钥、OpenAI-compatible 自定义端点、取消和配置写入失败。

### T1603：完成可操作的 Provider 空状态

让 Onboarding 直接提供保存密钥、选择模型和打开设置的操作，并显示缺失的是哪一项。测试三类
Provider、已配置/部分配置/无配置、键盘和焦点、错误恢复、窄侧栏与主题。

### T1604：实现 Provider 凭据删除与轮换

提供用户可发现的删除和替换入口；删除前显示 Provider 身份但不显示 Secret；轮换使用新的遮蔽输入，
只有现有 `ApiKeySecretStorage.save` fulfilled 后才将新值视为提交。取消若发生在 storage side effect 前则
不调用适配器；调用开始后的 rejected 结果为 indeterminate，不读取 Secret、不补偿写入或声称旧值仍在，
而是进行仅布尔的存在性 reconciliation 并给出固定安全重试/设置提示。删除确认后先由现有 presence
adapter 查询；明确 absent 时返回固定 no-op 且不调用 delete，非 absent 时才调用一次现有 adapter delete；
VS Code API 不保证 delete 幂等，rejected 同样是 indeterminate。状态查询只回答是否存在，presence adapter
只能将不可避免的 `get` 结果与 `undefined` 比较后立即丢弃，不检查长度/前后缀/内容。删除和轮换为
Extension Host-only Command Palette workflows，不扩展 T1603 Onboarding、Webview 或 Protocol；同一
Provider 的 save/delete/rotate/presence 命令必须等待 mutation settlement 与 reconciliation 后再释放。
dispose 或过期 generation 后不得发布通知、Webview status 或日志。测试删除、轮换、取消、存储失败、
并发命令、无现有密钥和日志不泄密。

### T1605：验证 Provider/Model 连接与必需能力

在用户明确触发时执行不含工作区内容的最小连接检查，并根据当前官方 API/SDK 可验证信息报告认证、
模型存在性以及 Tool Calling、流式输出和所需能力是否已知；无法可靠探测时显示“未知”而不是猜测。
检查不自动修改 Provider、模型或密钥。测试三类 Provider、支持/不支持/未知能力、认证失败、限流、
自定义端点、取消、超时、敏感错误脱敏和配置保持不变。

## 4. 阶段门禁

- 三个 Provider 都能在不编辑秘密配置文本的情况下完成密钥保存。
- 用户可以删除或轮换每个 Provider 的凭据；fulfilled 变更可确认，rejected 变更明确显示为
  indeterminate 并通过仅布尔存在性 reconciliation 提供安全重试/设置下一步，不声称旧 Secret
  必然保留或已删除；不存在时删除走 presence-only no-op，不依赖 VS Code delete 的幂等保证。
- 模型配置错误可被用户发现和修复，网络失败有手工降级。
- 用户触发的连接检查区分支持、不支持和未知，不发送工作区或会话内容。
- 无 Secret、授权头或敏感第三方响应进入 Webview、日志、持久化、fixture 或提交。
- 自动化测试和三类 Provider 的无真实网络人工配置路径通过。
