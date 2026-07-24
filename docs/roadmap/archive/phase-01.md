# 阶段 1：Extension 与 Webview 外壳

### T0101：创建最小 VS Code Extension

**目标**：Extension Development Host 能激活插件。

**开始前约束门禁**：建立或更新 `docs/architecture.md`，至少定义 Extension 激活与停用生命周期、Disposable 所有权、命令命名、URI 边界、适配器职责和惰性初始化要求；长期架构红线同步到 `AGENTS.md`。

**产物**：`extension.ts`、Extension `package.json`、esbuild 配置。

**测试**：Extension 集成测试验证激活成功。

### T0102：注册 Activity Bar View

**目标**：侧边栏出现 Agent 图标和空 View。

**测试**：验证 View Provider 注册；人工确认 View 可打开。

### T0103：创建 React Webview 构建

**目标**：Vite 生成静态资源，View 显示简单页面。

**开始前约束门禁**：建立 `docs/webview.md`，至少定义状态所有权、VS Code API 单一封装、组件职责、CSS Modules、VS Code CSS Variables、无障碍要求和流式渲染约束；长期边界同步到 `AGENTS.md`。

**测试**：Webview build 成功；HTML 资源 URI 使用 `asWebviewUri`。

### T0104：配置 Webview 安全策略

**目标**：设置 nonce、CSP 和 `localResourceRoots`。

**开始前约束门禁**：建立或更新 `docs/security.md`，至少定义默认拒绝的 CSP、nonce、最小 `localResourceRoots`、本地资源 URI、远程资源限制和不可信内容消毒规则。

**测试**：生成的 HTML 包含 CSP；禁止任意内联脚本。

### T0105：建立双向消息通道

**目标**：Webview 可发送 ping，Extension 返回 pong。

**开始前约束门禁**：建立 `docs/protocol.md`，至少定义 Envelope、协议版本、消息命名、请求关联、未知消息处理、运行时校验和可序列化边界。

**测试**：Protocol 单元测试和 Controller 单元测试覆盖往返消息。

### 阶段 1 门禁

- 侧边栏可以打开。
- Webview 与 Extension 能通过已校验协议双向通信。
- Webview 不拥有文件或密钥访问能力。

---

> 本阶段已完成。任务状态与完成证据以 [实施计划索引](../../implementation-plan.md) 中的任务台账为准；正常执行新任务时无需读取本归档。
