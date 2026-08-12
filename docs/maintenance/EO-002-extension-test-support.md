# EO-002 Extension Test Support

## Maintenance Change

- Goal: Establish private, minimal test fixtures for repeated Extension `Uri` values and Webview
  host behavior, then remove the superseded test-local fakes.
- Reason: Seven Extension adapter/controller tests independently implemented equivalent URI
  fakes/helpers (six `TestUri` classes plus one full `Uri` object factory), while
  the App and approval-store Webview tests independently implemented equivalent host doubles. The
  copies increase fixture drift without owning production behavior.
- Scope: Add one Extension-private URI fixture and one Webview-private host fixture, migrate the
  equivalent callers, and remove the duplicate fake implementations. The shared fixtures remain
  test-only and do not carry production policy.
- Planned files:
  - `apps/extension/src/test/support/test-uri.ts`
  - `apps/extension/src/adapters/vscode-diagnostics.test.ts`
  - `apps/extension/src/adapters/workspace-file-reader.test.ts`
  - `apps/extension/src/adapters/workspace-file-lister.test.ts`
  - `apps/extension/src/adapters/workspace-scope.test.ts`
  - `apps/extension/src/adapters/vscode-language-services.test.ts`
  - `apps/extension/src/adapters/vscode-editor-context.test.ts`
  - `apps/extension/src/controllers/readonly-tool-registry.test.ts`
  - `apps/webview/src/test/support/webview-host.ts`
  - `apps/webview/src/app.test.tsx`
  - `apps/webview/src/approval-store.test.ts`
  - `docs/engineering-opportunities.md`
  - `docs/maintenance/EO-002-extension-test-support.md`
- Public-contract impact: None. Production modules, configuration, commands, protocol DTOs,
  package entry points, dependencies, persistence, and runtime behavior remain unchanged.
- Explicitly excluded: Production code changes, package-level `testkit` dependency changes,
  public exports, new runtime dependencies, changes to test commands or configuration, migration of
  caller-specific host objects that do not share the same behavior, and unrelated refactoring.
- Build vs Buy triggers: Existing equivalent test-support implementations in multiple locations;
  no general-purpose runtime mechanism or dependency is required.
- Build vs Buy decision and evidence: Reuse and deepen package-private test support. The Extension
  fixture models only the small VS Code `Uri` shape already required by these tests, and the Webview
  fixture records the existing protocol messages and subscription lifecycle already defined by the
  local `WebviewHost` port. Standard library/VS Code APIs do not provide a test fake, and no existing
  package testkit owns either application-private host boundary. Adding a dependency would add
  license, update, packaging, and toolchain burden without reducing policy or lifecycle maintenance;
  no dependency or production path is introduced. The fixtures are deterministic, in-memory, and
  have no network, cancellation, security, or resource lifecycle beyond the existing subscription
  cleanup behavior.
- Reuse Audit: Searches covered `TestUri`, `Uri implements`, `createTestUri`, `with`, `toJSON`,
  `FakeWebviewHost`, `WebviewHost`, `sent`, `subscribe`, and `emit` across `apps/extension/src`,
  `apps/webview/src`, `packages/testkit` (if present), and the applicable development/testing
  guidance. The existing Extension copies in `vscode-diagnostics.test.ts`,
  `workspace-file-reader.test.ts`, `workspace-file-lister.test.ts`, `workspace-scope.test.ts`,
  `vscode-language-services.test.ts`, `vscode-editor-context.test.ts`, and
  `readonly-tool-registry.test.ts` share URI identity and transformation behavior; the App and
  approval-store classes share the same host message and subscription behavior. No owning
  production or package-level testkit interface was found.
  Decision: deepen each application package's private test support directory with one minimal
  fixture interface and migrate only equivalent callers. No repository-wide utility or expanded
  `packages/testkit` dependency is created.
- Verification: Run the nine affected test files, Extension/Webview typechecks, affected and full
  unit tests, repository check, build, integration tests as applicable, then `git diff --check`,
  status, and final diff review. Keep test names and observable assertions unchanged except where
  the approval-store test now asserts the shared fixture's protocol message directly.

## Similarity Audit

- New behavior searched: `createTestUri`, `TestUriParts`, `WebviewHostFixture`,
  `createWebviewHostFixture`, `TestWebviewHost`, and the former `TestUri`/`FakeWebviewHost` method
  bodies after migration.
- Removed implementations: seven Extension-local URI fakes/helpers (six `TestUri` classes and the
  `readonly-tool-registry.test.ts` object factory); the
  App-local and approval-store-local `FakeWebviewHost` classes. Their implementation-specific
  setup is now owned by the two private fixture modules.
- Removed or reduced implementation-specific tests: no standalone fake tests existed. Existing
  adapter and Webview behavior tests continue to exercise URI projection, URI comparison,
  protocol-message recording, subscription delivery, and terminal-approval behavior through the
  shared fixtures. The approval-store assertion retains the same observable decision check using
  the protocol DTO.
- Remaining similarities: Other Webview tests still use smaller, caller-specific host object
  literals (`createHost`) for stores that need different captured state or only a narrow subset of
  optional methods. They do not share the App/approval fixture's message-recording and event
  delivery semantics, so they remain private to their owning test and are outside this tranche.
  Two Extension tests still have local `uri` object factories, but their semantics differ from
  this fixture (one keeps a Windows-style `fsPath`, and one only models a canonicalizer boundary),
  so they are not equivalent `TestUri` implementations for this maintenance. The former
  authority-varying helper in `readonly-tool-registry.test.ts` was migrated in this revision.
  Extension integration tests use real VS Code `Uri` values and are not test fakes.
- Disposition: No duplicate `TestUri` or full `FakeWebviewHost` implementation remains. Future
  application tests should reuse the package-private fixture when they need the same semantics;
  broader host-helper consolidation requires separate evidence and ownership.

## Completion

- Implementation summary: Added Extension-private `createTestUri` support with a small URI parts
  interface and Webview-private `createWebviewHostFixture` support with protocol recording and
  subscription delivery. Migrated seven Extension adapter/controller tests plus the App and
  approval-store Webview tests; no production, protocol, configuration, command, dependency, or package entry
  point changed.
- Test results:
  - Affected tests: 9 files, 100 tests passed.
  - Full unit suite: 143 files, 1,706 tests passed (`pnpm run test:unit`).
  - Full workspace typecheck passed (`pnpm run typecheck`).
  - Biome repository check passed (`pnpm run check`, 375 files).
  - Workspace build passed (`pnpm run build`).
  - Extension integration passed with exit code 0; the existing VS Code harness logged the
    non-fatal `Error mutex already exists`, `Canceled Failed to load custom agents`, and extension
    host responsiveness messages.
  - `git diff --check` passed after the final diff review.
- Similarity Audit: Final search confirmed that the duplicate `TestUri` classes and full
  `FakeWebviewHost` classes are gone; remaining local helpers have the distinct semantics described
  above.
- Deleted or replaced old implementations: See above.
- Design deviation: None.
- PR/branch: `codex/eo-002-extension-test-support` (no commit, push, or PR created by the
  executor).
