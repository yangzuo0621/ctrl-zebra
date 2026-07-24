# 阶段 0：工程基础

### T0001：初始化 pnpm workspace

**目标**：建立空的多包工作区。

**产物**：

- 根 `package.json`。
- `pnpm-workspace.yaml`。
- `tsconfig.base.json`。
- `apps/` 和 `packages/` 中的空包。

**测试**：

- `pnpm install` 成功。
- `pnpm -r exec tsc --noEmit` 能运行。

**不包含**：VS Code Extension 代码、React UI、模型 SDK。

### T0002：配置质量工具

**目标**：建立统一的格式、lint 和类型检查命令。

**开始前约束门禁**：确定仓库的文本编码、换行、忽略文件和机械格式规则；规则由工具配置执行，不在 `AGENTS.md` 中重复。

**产物**：Biome 配置、`.editorconfig`、`.gitattributes`、`.gitignore` 和根脚本 `check`、`typecheck`。

**测试**：故意制造格式或类型错误时命令失败，恢复后通过。

### T0003：配置 Vitest

**目标**：让所有纯 TypeScript 包可以运行测试。

**开始前约束门禁**：建立 `docs/testing.md`，至少定义测试分层、命名、Fake/Mock 边界、确定性要求、回归测试和异步清理规则。

**产物**：共享 Vitest 配置和一个最小 smoke test。

**验收**：`pnpm test` 成功，且确实执行了测试文件。

### T0004：建立 CI

**目标**：对 `main` 的 push 以及以 `main` 为目标分支的 pull request 自动执行 install、check、typecheck、test 和 build。

**开始前约束门禁**：明确 CI 的 pnpm 版本、frozen lockfile、最小权限、任务超时、缓存范围、第三方 Action 固定方式和 Secret 禁用规则。

**验收**：GitHub Actions 工作流语法有效；本地存在等价命令。

### 阶段 0 门禁

- 空项目可以完整安装、检查、测试和构建。
- 后续包无需复制 TypeScript 或测试配置。

---

> 本阶段已完成。任务状态与完成证据以 [实施计划索引](../../implementation-plan.md) 中的任务台账为准；正常执行新任务时无需读取本归档。
