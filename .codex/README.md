# CtrlZebra Codex workflows

Ordinary implementation uses MANUAL: implement the authorized scope, verify, and report. It does not
automatically start independent review or grant Git/PR permissions.

For an explicitly selected AUTO run, Root coordinates Task-Executor, Task-Reviewer, and mechanical
closure. Read [auto-workflow](../.agents/skills/auto-workflow/SKILL.md) for the authoritative
invocation boundary, AUTO_DRAFT/AUTO_FULL grants, review limit, closure gates, and final states.
Reading this reference or mentioning a profile does not authorize it for a task.

| Role | Owner instructions | Purpose |
|---|---|---|
| Executor | [task-executor](../.agents/skills/task-executor/SKILL.md) | Implementation, verification, authorized early PR, and review fixes |
| Reviewer | [task-reviewer](../.agents/skills/task-reviewer/SKILL.md) | Read-only independent review when explicitly requested or dispatched by AUTO |
| Planner | [sol-planner](../.agents/skills/sol-planner/SKILL.md) | Project decomposition or substantial planning escalation |

The [agent configuration files](agents/) select role models and permissions; each loads its owner
skill. [AGENTS.md](../AGENTS.md) owns repository constraints and development authorization;
[development guidelines](../docs/development.md#reuse-before-build) own reuse tiers.
