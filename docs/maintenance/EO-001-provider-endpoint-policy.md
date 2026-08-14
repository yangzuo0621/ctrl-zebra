# EO-001 Provider Endpoint Policy

## Maintenance Change

- Goal: Establish one Extension-private provider endpoint policy and remove the two equivalent
  endpoint/loopback decisions from their callers.
- Reason: `provider-configuration.ts` and `provider-connection-check-command.ts` separately
  implemented endpoint structure, explicit loopback recognition, and API-key requirements, risking
  security-policy drift.
- Scope: Add `provider-endpoint-policy.ts` and its contract tests; migrate both Extension callers;
  remove superseded endpoint algorithms/tests; record this evidence.
- Planned owners: `apps/extension/src/adapters/provider-endpoint-policy.ts` and its test,
  `provider-configuration`, `provider-connection-check-command`, their tests, and this record.
- Public-contract impact: None. Configuration keys, commands, Provider DTOs, persistence, package
  entry points, and dependencies remain unchanged.
- Explicitly excluded: Configuration/command changes, Provider SDK/dependency changes, public exports,
  persisted-format changes, module-boundary changes, and unrelated refactoring.
- Build vs Buy: Build the small Extension-private product policy. WHATWG `URL` supplies parsing and
  normalization but not CtrlZebra transport, loopback, or credential policy; no dependency owns this
  boundary, and adding one would retain the adapter/security maintenance.
- Reuse: The two caller implementations were the only equivalent owners. Deepen the private policy,
  keep caller-specific error/UI mapping at each boundary, and do not create a repository-wide utility.
- Verification: Contract tests cover absent values, normalization, HTTPS/loopback acceptance,
  rejection and malformed-input boundaries; caller tests retain configuration/error mapping and
  credential ordering. Repository type/check/build/integration verification passed.

## Similarity Audit

The policy now owns endpoint normalization, explicit loopback recognition, and `requiresApiKey`.
The caller-local URL/credential/transport/loopback algorithms and duplicate matrices were removed.
The connection-check caller still composes a model path from the normalized URL; that is request-builder
ownership rather than endpoint validation. Caller-specific `ProviderConfigurationError` mapping also
remains intentionally local. Future endpoint semantics belong in this private policy and its contract
tests.

## Completion

- Implementation summary: Both Extension callers use `providerEndpointPolicy`; existing error/reporting
  behavior remains at each caller and no configuration, command, public contract, persistence, or
  dependency changed.
- Verification conclusion: Focused/unit tests, workspace typecheck, repository check, build, integration,
  and final diff review passed; the existing VS Code harness warning was non-fatal.
- PR/branch: [draft PR #215](https://github.com/yangzuo0621/ctrl-zebra/pull/215),
  `codex/eo-001-provider-endpoint-policy`.
- Review handoff: Independently verify endpoint-policy equivalence, deletion of superseded logic/tests,
  public-contract stability, and the evidence above.
