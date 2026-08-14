# EO-012 MCP SDK-native negotiation

## Scope Gate

- Base: exact latest `origin/main` `dd029517fc821c46fc90867a3e5decac6a92aad4`; branch
  `codex/eo-012-mcp-sdk-native-negotiation`.
- Authorized tranche: one independent investigation/proof maintenance change comparing the
  package-owned modern-first negotiation with the public negotiation API of the pinned
  `@modelcontextprotocol/client@2.0.0`. The tranche adds a deterministic differential corpus and
  records an Adopt / Partial adopt / Reject decision. It does not assume that a smaller diff is a
  safer protocol implementation.
- Contract gate: no Protocol/Core/Extension contract, package entry-point export, SDK version,
  dependency, configuration, persistence, command, transport, approval, security policy,
  capability set, or user-visible error changes.
- Handoff gate: the evidence and test remain on this branch for independent task-reviewer review;
  task-executor does not merge or close the PR.

## Maintenance Change

- **Goal:** Determine whether the pinned MCP SDK can own wire-level version negotiation without
  weakening CtrlZebra's closed modern-only/dual downgrade rules, stable errors, cancellation,
  generation fencing, or Host-owned process cleanup.
- **Reason:** `packages/mcp-client/src/mcp-negotiation.ts` currently owns the probe request,
  JSON-RPC classification, corrective `-32022` exchange, bounded `DiscoverResult` and capability
  validation, timeout behavior, and the exact dual fallback set. `ControlledMcpClient` then passes a
  validated `{ prior }` verdict to the SDK. The pinned SDK v2 now exposes public
  `versionNegotiation` and `ConnectOptions.prior`, so retaining this private wire state machine
  requires evidence rather than assumption.
- **Scope:** Use the existing `FixtureStdioPort` and `SdkStdioTransport` to run the same deterministic
  probe corpus through `ControlledMcpClient` and the SDK's public `Client.connect` negotiation modes.
  Cover modern success, defined non-modern error, timeout, unknown JSON-RPC error, malformed result,
  recognized modern error without a mutual modern version, malformed modern-only pin behavior,
  server exit, stale-generation disconnect/late delivery, and cleanup/termination confirmation.
  Preserve the current implementation and add no shadow production
  path. Record the decision and the conditions for reopening it.
- **Planned files:**
  - `packages/mcp-client/src/eo012-sdk-native-differential.test.ts`
  - `docs/engineering-opportunities.md`
  - `docs/maintenance/EO-012-mcp-sdk-native-negotiation.md`
- **Public-contract impact:** None. The package entry point, CtrlZebra connection/capability/error
  contracts, closed protocol mode, persisted values, SDK version, and Host lifecycle remain
  unchanged.
- **Explicitly excluded:** Replacing `mcp-negotiation.ts`; changing `sdk-options.ts`; enabling SDK
  `auto` or a second negotiation path in production; adding a two-process probe transport;
  changing modern-only/dual semantics; broadening the fallback matrix; changing process ownership,
  Workspace Trust, approval, stderr/byte bounds, cancellation, generation fencing, cleanup,
  configuration, Protocol DTOs, Webview behavior, or dependencies.

## Reuse Audit

- **Initial repository-wide searches and evidence:**
  - `rg -n "EO-012|SDK-native|versionNegotiation|negotiateMcpEra|server/discover|PriorDiscovery|ConnectOptions" packages apps docs`
  - `rg -n "McpNegotiationFailure|protocol-incompatible|malformed-message|probeTimeoutMs|protocolMode|generation|termination-unconfirmed" packages/mcp-client apps/extension docs`
  - Re-read `docs/engineering-opportunities.md` EO-012, `docs/development.md` Reuse Before Build
    and Build vs Buy, `docs/testing.md`, and the Controlled MCP Client Boundary plus closed
    fallback matrix in `docs/architecture.md`.
  - Resolved the pinned official SDK through Context7 and inspected the installed `2.0.0` public
    declarations and implementation. The public API is `ClientOptions.versionNegotiation` with
    modes `'legacy' | 'auto' | { pin: string }`, `VersionNegotiationProbeOptions`, and
    `ConnectOptions.prior`; the SDK's own stdio sibling-process behavior applies only to its exact
    base `StdioClientTransport`.
- **Found existing owners:** `packages/mcp-client/src/mcp-negotiation.ts` owns CtrlZebra's closed
  classification and bounded validation; `ControlledMcpClient` owns generation, cancellation,
  delivery-gate, and termination confirmation; `SdkStdioTransport` adapts the Host-owned process
  port and fences late probe IDs; `packages/mcp-client/src/sdk-options.ts` pins the modern SDK
  version after a package-owned verdict. No existing repository or dependency mechanism expresses
  the CtrlZebra fallback whitelist and Host lifecycle together.
- **Reuse decision:** Reuse the official SDK only for the already-approved Client/transport/DTO
  adapter. Do not reuse SDK-native negotiation as the production owner because its public policy is
  intentionally broader than CtrlZebra's closed matrix and its custom-stdio lifecycle is not the
  SDK's disposable sibling path. The differential test calls only public SDK APIs and the existing
  package fake; it does not import SDK internals or create a second production abstraction.
- **Second/third implementation assessment:** The SDK negotiation state machine and the package
  negotiation state machine are the two observed implementations. This tranche deliberately does
  not layer them or leave both active in production. The test is evidence for rejecting a replacement,
  not a permanent fallback shadow implementation.

## Build vs Buy

- **Trigger:** Protocol negotiation is a general-purpose protocol primitive with substantial
  boundary behavior, an existing maintained official implementation, and a current private
  implementation exceeding the review threshold. A Build vs Buy decision is mandatory.
- **Buy candidate:** the pinned official `@modelcontextprotocol/client@2.0.0` public
  `versionNegotiation` / `Client.connect` implementation. It is the correct source for MCP wire
  DTOs and protocol mechanics, is already in the workspace, and adds no dependency or VSIX cost.
- **Build candidate:** the existing package-private `mcp-negotiation.ts` deepens CtrlZebra-owned
  policy around the SDK's transport. It keeps one bounded probe, the closed eligible non-modern
  error set, modern-error locking, strict malformed/unknown rejection, generation fencing, and
  stable error mapping. It is not a second generic protocol library.
- **Decision:** **Reject SDK-native negotiation for the current pinned SDK and transport.** Keep the
  existing package-owned negotiation seam. This is a policy/lifecycle decision, not a rejection of
  the SDK: the SDK remains the transport, Client, JSON-RPC, and DTO mechanism after the package-owned
  verdict is handed over with `ConnectOptions.prior`.
- **Maintenance status:** Investigation/proof tranche complete; the selected maintenance outcome is
  **Reject**, with no production migration or follow-up implementation active. The existing
  `mcp-negotiation.ts` owner remains the supported path until the reopen gate below is met.
- **License and maintenance:** The already-pinned `@modelcontextprotocol/client@2.0.0` package is
  MIT-licensed, maintained in the official TypeScript SDK repository, and introduces no dependency
  or lockfile change in this maintenance tranche. The package-owned seam remains MIT-licensed
  CtrlZebra code with the repository's existing owner and review lifecycle.
- **Runtime and toolchain compatibility:** The installed SDK declares Node `>=20`; the repository
  baseline uses `pnpm@11.11.0`, TypeScript `7.0.2`, and the existing ESM workspace. The public
  `Client`, `SdkError`, `SdkErrorCode`, transport, and `ConnectOptions.prior` declarations compile
  under that baseline. No runtime or toolchain upgrade is proposed.
- **Packaging and VSIX impact:** Reject leaves package manifests, `pnpm-lock.yaml`, production
  bundles, and the extension contribution surface unchanged. The package:vsix allowlist remains
  unchanged; the final clean-tree packaging run is recorded in Completion below. The differential
  corpus is test-only and is not included in the shipped VSIX.
- **Cancellation and security behavior:** The SDK comparison observes caller abort rejection,
  SDK-public typed error codes, transport `closeInput`/`terminate` counts, termination confirmation,
  and dropped late probe delivery. It does not delegate CtrlZebra's generation fencing, stable
  error mapping, Host trust/approval gates, byte budgets, or process-tree termination policy to the
  SDK. No cancellation, security, or lifecycle contract changes.
- **Project-owned adapter code:** No new adapter is required. The existing `SdkStdioTransport`
  remains the Host-owned port adapter; `ControlledMcpClient` continues to pass the validated
  package verdict through the public `{ prior }` input. SDK types and failures stay inside the
  package boundary and the test uses only public SDK symbols.
- **Measured package/type/test/net-code comparison:** `git diff --numstat` shows no production
  source, package manifest, or lockfile delta; the net implementation change is a 0-line
  production migration and one deterministic differential test file. The focused corpus now has
  six tests (including server exit, stale-generation disconnect/late delivery, and termination
  confirmation), while the prior regression/package counts are preserved in Completion. Typecheck
  and repository checks exercise the same package graph; the VSIX comparison records the unchanged
  allowlist and artifact byte counts rather than a second SDK negotiation path.
- **Rationale:** SDK `auto` classifies every unrecognized JSON-RPC probe error as a legacy signal,
  while CtrlZebra permits fallback only for a closed specification-defined set. SDK `auto` treats a
  malformed `DiscoverResult` as legacy, while CtrlZebra must return stable `malformed-message`
  without downgrade. A recognized `-32022` modern error with no modern overlap is modern evidence
  and must fail; SDK `auto` falls back when a legacy version is available. On the custom
  `SdkStdioTransport`, the SDK cannot identify the exact base `StdioClientTransport`, so it probes
  in place and classifies timeout/close as a typed negotiation failure rather than the stdio legacy
  signal. Finally, SDK failures are SDK error objects, not the stable CtrlZebra error union, and the
  SDK has no Host-owned generation or termination-confirmation contract.
- **Alternatives and impact:**
  - **Adopt:** configure SDK `auto` and delete `mcp-negotiation.ts`. This would widen legacy
    downgrade for unknown/malformed outcomes and change timeout/close behavior on the custom
    transport; rejected by the matrix and security boundary.
  - **Partial adopt:** use SDK `auto` for modern-only while retaining the package path for dual.
    This creates two production negotiation owners and violates EO-012's no-dual-path requirement;
    it also leaves modern-only with SDK error/classification differences. Rejected.
  - **Reject (selected):** retain one package-owned negotiation seam and continue handing its
    validated result to the SDK with `{ prior }`. This preserves the existing public behavior and
    removes no production code, but avoids an unjustified compatibility regression.
- **Reopen trigger:** Re-evaluate only after an explicitly reviewed SDK release/API change can
  express all of the following through public APIs on a custom stdio-shaped transport: the closed
  eligible non-modern set; malformed versus unknown versus modern-error locking; bounded timeout and
  close outcomes; caller signal and generation delivery gates; stable error translation; and
  Host-owned process termination/confirmation. A future transport adapter that intentionally uses
  the SDK's exact disposable sibling `StdioClientTransport` would require a separate process,
  approval, and security review before it could change this decision. An SDK version bump alone is
  not a reopen trigger.

## Differential Corpus and Decision Matrix

The corpus uses the same `FixtureStdioPort` behavior and compares wire methods and terminal outcome.
The SDK column means public `Client.connect` with `versionNegotiation: { mode: "auto" }` and both
closed versions in `supportedProtocolVersions`; the CtrlZebra column means `ControlledMcpClient` in
`dual` mode. A mismatch is intentional evidence when it demonstrates a forbidden downgrade or
different lifecycle ownership.

| Corpus case | CtrlZebra package-owned result | SDK-native result on custom transport | Decision implication |
|---|---|---|---|
| Well-formed modern `DiscoverResult` advertising `2026-07-28` | One `server/discover`; connected modern | One `server/discover`; connected modern | Equivalent wire success; SDK transport/DTO reuse remains adopted. |
| Defined non-modern JSON-RPC error (`-32601`) followed by valid initialize | Probe then exactly one `initialize` / `notifications/initialized`; connected legacy | Same fallback sequence; connected legacy | Equivalent eligible fallback. |
| Bounded probe timeout | Dual enters exactly one legacy handshake; connected legacy | Custom transport is not SDK base stdio; `auto` rejects the timeout and does not initialize | SDK cannot preserve custom-stdio dual semantics. |
| Unknown implementation-defined JSON-RPC error (`-32000`) | Fails `protocol-incompatible`; no initialize | Falls back to legacy and initializes | SDK fallback is broader than the closed matrix. |
| Malformed `DiscoverResult` shape | Fails `malformed-message`; no initialize | Treats invalid modern result as legacy and initializes | SDK would turn malformed input into an unauthorized downgrade. |
| Recognized `-32022` with only legacy support | Fails `protocol-incompatible`; modern evidence locks, no initialize | Falls back to legacy and initializes | SDK does not preserve modern-error lock. |
| Modern-only pin with malformed result | Stable CtrlZebra `malformed-message` | SDK rejects with its own `SdkError`, with no CtrlZebra stable classification | SDK errors cannot replace the public client error mapping. |
| Server exit during probe | Fails `server-exited`; one `closeInput` and one confirmed termination | Rejects with public `SdkErrorCode.EraNegotiationFailed`; one `closeInput`, one confirmed termination, and a late response is dropped by the custom transport gate | SDK error classification is observable, but Host cleanup remains the owner. |
| Cancellation during probe | Cancelled outcome; delivery gate closes; one termination wait; late result ignored | SDK rejects its connect promise with `SdkErrorCode.EraNegotiationFailed`; the caller closes the custom transport, observes one termination, and confirms late delivery is dropped | Signal handling is not a substitute for CtrlZebra generation/cleanup ownership. |
| Stale generation / disconnect race | `disconnect()` increments the active generation while the probe is in flight; a late probe response cannot commit the old connection, `connect` resolves cancelled, disconnect resolves disconnected, cleanup runs once, and no initialize/method side effect is sent | No SDK `generation` concept; after caller-owned close, the transport gate drops the same late response and emits no later method | Generation and post-cancel side-effect policy must remain package/Host-owned. |
| Termination confirmation | Stable disconnect result distinguishes `terminated` from `unconfirmed` | SDK connect can resolve, while the custom transport still exposes `terminateCount=1` and `termination="unconfirmed"` | SDK does not own CtrlZebra's termination-confirmation contract. |

## Similarity Audit

- **Final audit commands:**
  - `rg -n "negotiateMcpEra|McpNegotiationFailure|versionNegotiation|ConnectOptions|PriorDiscovery|server/discover" packages/mcp-client/src apps docs`
  - `rg -n "modern-only|dual|protocol-incompatible|malformed-message|probe timeout|legacy fallback|generation|termination confirmation" docs/engineering-opportunities.md docs/maintenance/EO-012-mcp-sdk-native-negotiation.md docs/architecture.md`
  - `git diff --check`, `git status --short`, and final diff review against exact base.
- **Actual symbol inventory:** `negotiateMcpEra` (one production definition in
  `mcp-negotiation.ts`, one existing caller in `controlled-mcp-client.ts`); `McpNegotiationFailure`
  (one production definition and existing stable error translation); SDK `Client.connect` and
  `versionNegotiation` are third-party public owners, not copied symbols. The new
  `eo012-sdk-native-differential.test.ts` has one test-only fixture runner for each side and no
  public export or production wrapper.
- **Removed implementations:** none. Reject is intentional because deletion would violate the
  current fallback matrix and lifecycle contract. No SDK + package dual production path was added.
- **Remaining similarities and disposition:** both implementations send `server/discover` and can
  produce modern/legacy handshakes; this is the unavoidable comparison surface. The SDK owns its
  protocol state machine internally; CtrlZebra owns the policy gate and hands a validated prior
  verdict to it. `FixtureStdioPort` remains the existing test fake; no duplicate process fake or
  transport implementation was introduced.
- **Independent reviewer comparison:** task-reviewer must repeat the repository-wide searches,
  inspect the pinned SDK public declarations/behavior, rerun the differential corpus, verify no
  production SDK-auto path exists, and compare each matrix disposition against the final diff.

## Verification

- Focused differential corpus: `pnpm exec vitest run packages/mcp-client/src/eo012-sdk-native-differential.test.ts`
- Existing negotiation/integration regression: `pnpm exec vitest run packages/mcp-client/src/t1805-negotiation.test.ts packages/mcp-client/src/sdk-integration.test.ts`
- Affected MCP package tests: `pnpm exec vitest run packages/mcp-client/src`
- Typecheck: `pnpm --filter @ctrl-zebra/mcp-client exec tsc --noEmit`, then `pnpm run typecheck`
- Broader verification: `pnpm run test:unit`, `pnpm run check`, `pnpm run build`,
  `pnpm run test:integration`, `git diff --check`, status, and final diff review.

## Completion

- **Implementation summary:** Added a deterministic package-local differential corpus and retained
  the existing package-owned negotiation implementation. No production path, public contract,
  dependency, configuration, or architecture boundary changed.
- **Decision:** Reject SDK-native negotiation for `@modelcontextprotocol/client@2.0.0` with the
  current custom stdio transport. Adopt the SDK's existing Client/transport/DTO mechanism only after
  the package-owned verdict via `{ prior }`.
- **Test results:** The focused differential corpus/regression command passed 3 files and 33 tests;
  the six-case EO-012 corpus includes public `SdkError.isInstance`/`SdkErrorCode` assertions,
  server-exit cleanup, stale-generation disconnect/late delivery, and termination confirmation;
  `pnpm exec vitest run packages/mcp-client/src` passed 19 files and 161 tests; the repository unit
  suite passed 162 files and 1,773 tests; `pnpm --filter @ctrl-zebra/mcp-client exec tsc --noEmit`
  and `pnpm run typecheck` passed; `pnpm run check` passed for 415 files; `pnpm run build` passed;
  and `pnpm run test:integration` exited 0. Integration emitted the existing non-fatal VS Code
  `cached-data` option and `Canceled Failed to load custom agents` warnings. `pnpm run package:vsix`
  passed on the clean packaging source revision `87229c77c07239986ff13b08eb388d186730f1e0`
  (the final evidence-only docs commit follows) with 12 allowlisted files, 831,671 compressed
  bytes, and 3,797,841 uncompressed bytes at
  `.artifacts/ctrl-zebra-0.1.1-87229c77c072.vsix`.
- **Similarity Audit:** The final search confirms one package-owned negotiation definition and no
  second production negotiation path; the added test imports only public SDK APIs and existing
  package fixtures. The matrix above records all intentional behavioral differences.
- **Design deviation:** None.
- **PR/branch:** `codex/eo-012-mcp-sdk-native-negotiation`; task-executor will provide the draft PR
  URL and reviewer handoff after commit/push.
