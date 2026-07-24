# Development Guidelines

Read this document for code, configuration, or dependency changes. Mechanical formatting remains
owned by Biome, EditorConfig, and Git attributes.

## Environment and Current Documentation

- On Windows, prefer PowerShell 7 (`pwsh`). Fall back to Windows PowerShell only for an unavailable
  runtime or a documented compatibility requirement, and report the reason.
- Use pnpm for workspace and dependency operations. Do not use npm or Yarn.
- Use current documentation instead of memory for libraries, frameworks, SDKs, APIs, CLI tools, and
  cloud services. Resolve the library through Context7, then query it with the task-specific question.

## TypeScript and Naming

- Use TypeScript strict mode.
- Accept external input as `unknown`, then validate or narrow it. Do not use `any` to bypass boundary
  checks.
- Prefer string unions or `as const` objects over TypeScript `enum`.
- Keep DTOs, domain objects, and UI state distinct.
- Treat cancellation as a separate outcome, not a generic failure.
- Do not swallow errors or branch on third-party error-message text.
- Use `kebab-case` filenames, `PascalCase` for types, classes, and React components, and `camelCase`
  for functions and variables. Do not prefix interfaces with `I`.
- Name tests `*.test.ts` or `*.test.tsx`.
- Comments explain constraints, rationale, or non-obvious behavior rather than restating code.

## Files and Formatting

- Use UTF-8, LF line endings, and a final newline for text files.
- Biome, EditorConfig, and Git attributes are authoritative for indentation, quotes, semicolons,
  import order, and other mechanical formatting.
- Do not format or rewrite unrelated files.
- Generate lockfiles through pnpm; never edit a lockfile manually.
- Do not commit build output, coverage, caches, platform temporary files, or private editor state.

## Imports and Public APIs

- Prefer named exports. Use default exports only for a concrete framework or toolchain convention.
- Use `import type` for type-only dependencies.
- Circular dependencies are forbidden.
- Do not create global barrel files that hide dependency direction or widen public APIs.
- Keep public APIs minimal; implementation details remain private until a cross-module use case
  requires an export.

## Dependencies

- Before adding a production dependency, confirm that the standard library and existing dependencies
  cannot reasonably satisfy the need, and state the reason for adding it.
- Install a dependency in the workspace package that uses it. Keep only repository-wide development
  tools at the root.
- Do not retain unpinned `latest` declarations. Keep one compatible dependency version across the
  workspace where practical.
- Do not add a large dependency for small, stable utility logic.
- Check maintenance status, license, runtime compatibility, and toolchain compatibility.
- Third-party library and SDK types must not appear in public domain contracts.

## Async Work and Resource Lifecycles

- Long-running or blocking operations accept an `AbortSignal`. If cancellation is impossible,
  document the reason and exact behavior.
- After cancellation, do not emit deltas, run tools, retry, or create side effects.
- Do not create unobserved promises or promises without a traceable owner.
- VS Code registrations, event listeners, timers, streams, child processes, and similar resources
  require an explicit owner and lifecycle disposal.
- Cleanup is idempotent. Timeout, cancellation, and failure remain distinguishable outcomes.
- Do not hide races with arbitrary delays or increased timeouts. The owning module controls each
  state transition.

## TODOs and Rule Exceptions

- Do not commit ownerless `TODO` or `FIXME` comments, commented-out code, or permanently skipped tests.
- A necessary temporary item includes a task or issue ID, its reason, and its removal condition.
- Do not silently bypass problems with Biome ignores, `@ts-ignore`, unsafe casts, or equivalent
  mechanisms.
- When an exception is unavoidable, constrain it to the smallest scope and explain why. Prefer a
  documented `@ts-expect-error` for expected TypeScript errors.
