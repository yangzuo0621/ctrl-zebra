# Recommended Prompts

Replace `<work-item>` with one exact Issue or standalone maintenance scope before use.

## MANUAL
```text
Execute <work-item> in MANUAL mode using the configured project workflow.
```

## AUTO_DRAFT (recommended for review-before-merge)
```text
Use auto-workflow to execute <work-item> in AUTO_DRAFT.
I explicitly authorize AUTO_DRAFT for <work-item> only.
```

## AUTO_FULL (recommended for end-to-end execution)
```text
Use auto-workflow to execute <work-item> in AUTO_FULL.
I explicitly authorize AUTO_FULL for <work-item> only.
```

## Project / Phase planning
```text
Use sol-planner to reconcile an approved work proposal with the current codebase and refine its
decomposition, dependencies, and ordering. Do not implement code.
```
