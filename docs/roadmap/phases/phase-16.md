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

## 4. 阶段门禁

- 三个 Provider 都能在不编辑秘密配置文本的情况下完成密钥保存。
- 模型配置错误可被用户发现和修复，网络失败有手工降级。
- 无 Secret、授权头或敏感第三方响应进入 Webview、日志、持久化、fixture 或提交。
- 自动化测试和三类 Provider 的无真实网络人工配置路径通过。
