# EO-002 Extension Test Support

## Maintenance Change

- Goal: Establish minimal private fixtures for repeated Extension `Uri` values and Webview host
  behavior, then remove superseded test-local fakes.
- Reason: Seven Extension adapter/controller tests duplicated URI fakes/helpers and App/approval-store
  tests duplicated Webview host doubles, creating fixture drift without owning production behavior.
- Scope: Add one Extension-private URI fixture and one Webview-private host fixture; migrate equivalent
  callers; remove duplicate fakes; preserve test-only ownership.
- Planned owners: `apps/extension/src/test/support/test-uri.ts` and its seven adapter/controller
  callers; `apps/webview/src/test/support/webview-host.ts` and App/approval-store callers; this record.
- Public-contract impact: None. Production modules, configuration, commands, Protocol DTOs, package
  entry points, dependencies, persistence, and runtime behavior remain unchanged.
- Explicitly excluded: Production code, package-level `testkit` changes, public exports, runtime
  dependencies, test command/configuration changes, non-equivalent host objects, and unrelated cleanup.
- Build vs Buy: Reuse/deepen package-private test support. The fixtures model only the existing VS Code
  `Uri` shape and local `WebviewHost` message/subscription port; no standard API or package testkit
  owns these application-private boundaries, and a dependency would add maintenance without policy value.
- Reuse: Migrate only equivalent URI and full host doubles. Keep smaller caller-specific helpers whose
  captured state or optional-method semantics differ.
- Verification: Affected and full unit tests, Extension/Webview typechecks, repository check/build,
  integration smoke, and final diff review passed.

## Similarity Audit

The shared fixtures now own URI identity/transformation and host message recording/subscription
delivery. The seven Extension-local URI fakes and App/approval-store full host classes were removed.
Existing behavior assertions remain in their callers, including protocol DTO recording and terminal
approval decisions. Other Webview `createHost` literals, two semantically different Extension URI
factories, and real VS Code integration URIs remain local by design; they do not implement the same
fixture contract. Future tests should reuse the package-private fixture only when those semantics match.

## Completion

- Implementation summary: Added `createTestUri` and `createWebviewHostFixture`, migrated the seven
  Extension tests plus App/approval-store Webview tests, and changed no production, protocol,
  configuration, command, dependency, or package entry point.
- Verification conclusion: Focused/full tests, typechecks, repository check, build, integration, and
  final diff review passed; existing VS Code harness warnings were non-fatal.
- Similarity disposition: No duplicate `TestUri` or full `FakeWebviewHost` implementation remains;
  remaining local helpers have distinct semantics.
- PR/branch: [draft PR #216](https://github.com/yangzuo0621/ctrl-zebra/pull/216),
  `codex/eo-002-extension-test-support`.
