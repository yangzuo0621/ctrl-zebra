# EO-001 Provider Endpoint Policy

## Maintenance Change

- Goal: Establish one Extension-private provider endpoint policy and remove the two equivalent
  endpoint/loopback decisions from their callers.
- Reason: `provider-configuration.ts` and `provider-connection-check-command.ts` separately
  implemented the same endpoint structure, explicit loopback recognition, and API-key requirement
  rules. Keeping both copies risks security-policy drift.
- Scope: Add `apps/extension/src/adapters/provider-endpoint-policy.ts`, migrate the two Extension
  callers to its interface, add equivalent policy contract coverage, and remove superseded
  implementation-specific endpoint tests.
- Planned files:
  - `apps/extension/src/adapters/provider-endpoint-policy.ts`
  - `apps/extension/src/adapters/provider-endpoint-policy.test.ts`
  - `apps/extension/src/adapters/provider-configuration.ts`
  - `apps/extension/src/adapters/provider-configuration.test.ts`
  - `apps/extension/src/controllers/provider-connection-check-command.ts`
  - `apps/extension/src/controllers/provider-connection-check-command.test.ts`
  - `docs/engineering-opportunities.md`
  - `docs/maintenance/EO-001-provider-endpoint-policy.md`
- Public-contract impact: None. Configuration keys, commands, Provider DTOs, persistence, and
  package entry points remain unchanged.
- Explicitly excluded: Configuration or command changes, Provider SDK/dependency changes, public
  package exports, persisted-format changes, module-boundary changes, and unrelated refactoring.
- Build vs Buy triggers: Existing equivalent implementation in two places; no general-purpose
  dependency or algorithm beyond the small product policy is required.
- Build vs Buy decision and evidence: Build by deepening an Extension-private module. The policy is
  CtrlZebra product security semantics (transport, explicit loopback, and credential requirement),
  not a general URL utility. The standard `URL` implementation remains the parser. No maintained
  dependency would remove meaningful algorithmic or security maintenance; adding one would add
  runtime/package surface without owning these rules.
- Reuse Audit: Search terms included `loopback`, `localhost`, `127.0.0.1`, `::1`, `requiresApiKey`,
  `new URL`, endpoint validation, and Provider endpoint policy across `apps/extension/src`, tests,
  `docs/architecture.md`, and `docs/security.md`. The two candidates were the endpoint reader in
  `provider-configuration.ts` and metadata-target validation in
  `provider-connection-check-command.ts`; both had equivalent behavior and no existing shared
  owner. Decision: deepen into the Extension-private policy module, keep caller-specific error and
  UI mappings at each boundary, and do not create a repository-wide utility. No third equivalent
  implementation was found.
- Verification: Policy contract tests cover absent values, URL normalization, HTTPS/loopback
  acceptance, remote HTTP rejection, lookalike/credential/query/fragment rejection, and safe
  errors. Caller tests retain configuration projection and connection-check mapping/credential
  ordering coverage. Run affected tests, Extension typecheck, repository checks, full unit tests,
  and final `git diff --check`/status review.

## Similarity Audit

- New behavior searched: `providerEndpointPolicy`, `ProviderEndpointPolicy`, `requiresApiKey`,
  `isExplicitLoopbackHostname`, and endpoint validation patterns after migration.
- Removed implementations: `readOptionalEndpoint` URL/credential/transport/loopback algorithm and
  `isExplicitLoopbackHostname` from `provider-configuration.ts`; the corresponding URL/credential/
  transport/loopback algorithm and helper from `provider-connection-check-command.ts`.
- Removed or reduced implementation-specific tests: endpoint acceptance/rejection matrices were
  moved to `provider-endpoint-policy.test.ts`; caller tests now assert policy handoff and retain
  caller-owned configuration/error behavior.
- Remaining similarities: The connection-check caller still constructs a `URL` from the policy's
  already-normalized value to append its model path. This is URL path composition, not endpoint
  validation, and remains owned by the metadata request builder. Caller-specific
  `ProviderConfigurationError` mapping also remains intentionally separate.
- Disposition: No active duplicate endpoint policy remains. Any future endpoint semantics must be
  added to the Extension-private policy and covered by its contract tests.

## Completion

- Implementation summary: Pending implementation verification.
- Test results: Pending.
- PR/branch: `codex/eo-001-provider-endpoint-policy` (draft PR pending publication).
- Review handoff: Task-reviewer must independently verify endpoint policy equivalence, deletion of
  superseded logic/tests, public-contract stability, and the evidence above.
