# Phase 1 Release Checklist

This checklist is the T1005 release gate for the desktop VSIX. It records repository readiness; it
does not authorize Marketplace publication, version changes, tags, or release creation.

## User documentation

- [x] The root and packaged README files are identical and describe requirements, VSIX installation,
  a complete Gemini onboarding path, local OpenAI-compatible setup, configuration, tools, approvals,
  local data, privacy, limitations, development checks, and licensing.
- [x] Every contributed `ctrlZebra.provider.*` setting is documented with its default, scope,
  accepted values, and security constraints.
- [x] Known limitations distinguish Phase 1 behavior from future candidates and identify incomplete
  remote-provider credential onboarding.
- [x] The privacy notice distinguishes local storage, provider transmission, approved-command
  behavior, non-collection, retention limitations, and third-party terms.

## Legal and package content

- [x] The project uses the MIT License with copyright `2026 Zuo Yang`.
- [x] Root and packaged LICENSE files are identical, manifests declare `MIT`, and packaging validates
  the documents before building.
- [x] The official package command does not bypass the `vsce` license check.
- [x] The VSIX allowlist includes the processed license and excludes Source Maps, tests, caches,
  credentials, local state, and `node_modules`.

## Security and operation

- [x] The README states that prompts, relevant context, and tool results can be sent to the selected
  model provider.
- [x] Credential entry uses VS Code SecretStorage, and documentation warns against placing keys in
  chat, settings, workspace files, logs, or commands.
- [x] Read tools remain workspace-scoped; file writes and commands require workspace trust and an
  exact fresh approval.
- [x] Session recovery never resumes model, approval, or tool side effects, and Checkpoint restore is
  documented as conflict-safe rather than a merge operation.

## Final verification

- [x] `pnpm install --frozen-lockfile`, `pnpm check`, `pnpm typecheck`, `pnpm test:unit`,
  `pnpm test:integration`, and `pnpm build` pass.
- [x] `pnpm package:vsix` produces a clean, upstream-traceable artifact whose independent inspection
  confirms the allowlist, license, commit, and size limits.
- [x] `pnpm smoke:vsix -- <artifact>` installs that exact VSIX in isolated user-data and extensions
  directories, activates CtrlZebra, opens the Agent view, and observes the expected structured log.
- [x] `git diff --check`, final diff review, and `git status --short` show only the intended T1005
  source changes before commit and a clean worktree before official packaging.

The verification items are checked only after the commands execute successfully on the release
candidate commit. A checked repository gate is not evidence that the VSIX was published.

Verification completed on 2026-07-22. The inspected and smoke-tested candidate is
`ctrl-zebra-0.0.0-2dee574f5cdf.vsix`: 11 files, 437,435 compressed bytes, 2,367,140 uncompressed
bytes, with source commit `2dee574f5cdf724703bb0b44858ba7b7999a18d2` in its build metadata.

## Stage 14 MCP release addendum

The T1409 candidate must additionally satisfy the following gates before its PR is merged. These
checks do not authorize Marketplace publication, remote MCP transports, authentication, or any
capability outside Stage 14.

- [x] A deterministic local fixture proves exact MCP `2026-07-28` negotiation, paginated Tools,
  Resources, Resource Templates and Prompts, list-change refresh, Tool calls, Resource reads, Prompt
  retrieval, errors, cancellation, disconnect, late-result rejection and process cleanup without
  network access, developer configuration or credentials.
- [x] Extension Host integration verifies configuration validation, explicit connection rejection,
  disconnect and lack of automatic startup through public commands; controller and component tests
  retain exact startup and per-Tool approval coverage.
- [x] The README documents configuration, startup risk, the three Server primitives, approvals,
  recovery and known limitations; the privacy notice covers external Server and model-provider data
  flows.
- [x] The VSIX smoke test exercises the installed MCP configuration and disconnect gates. Independent
  archive inspection confirms the artifact contains no fixture Server, MCP configuration, raw MCP
  log, credential, cache or unreviewed executable.
- [x] `pnpm install --frozen-lockfile`, `pnpm check`, `pnpm typecheck`, `pnpm test`, and `pnpm build`
  pass on the candidate; the exact clean, pushed commit passes `pnpm package:vsix` and
  `pnpm smoke:vsix -- <artifact>`.
- [x] Manual trusted and untrusted workspace paths verify connection/startup approval, Tools,
  Resources, Prompts, cancellation, failure, explicit restart and disconnect with no late UI,
  context injection, persistence, model continuation or residual process.

## Stage 21 complete local-data handoff addendum (T2106)

- [x] The uninstall-before/device-handoff path is documented in both README files and PRIVACY.md:
  invoke `CtrlZebra: Clear All Local Data`, accept the modal high-risk warning, and retry any
  category reported as partial before uninstalling.
- [x] The path explicitly excludes workspace files/user code, VS Code data outside CtrlZebra, and
  other Extension state, and documents local-only handling of Sessions, Checkpoints, temporary/cache
  state, Provider Secret, MCP/Provider configuration, and other CtrlZebra state.
- [ ] On the release candidate, verify the exact VSIX command path, empty/all-category cleanup,
  partial SecretStorage/files/config failures, running-operation settlement, restart, concurrent
  calls, and idempotent retry in the release environment.

## Stage 22 reproducible release addendum (T2206)

These gates verify release metadata and retained artifacts; they do not authorize a version change,
tag creation, GitHub Release creation, or Marketplace publication.

- [ ] The extension manifest version, `CHANGELOG.md` release notes, `pnpm-lock.yaml` importer
  specifiers, and the matching `v<version>` tag are consistent.
- [x] The official package command records the source commit, version, lockfile digest, changelog
  digest, and validated source ref/type in VSIX build provenance; packaging the same clean commit
  twice produces the same artifact digest.
- [x] The retained artifact includes a SHA-256 checksum, a deterministic SPDX-2.3 SBOM, and a
  third-party dependency/license inventory whose declared packages and licenses match the lockfile.
- [x] The VSIX archive is independently audited against its allowlist and declared runtime
  dependencies; source maps, development caches, workspace state, credentials, and undeclared
  executables are rejected.
- [x] The release workflow is manual by default, runs only from the protected main branch or the
  matching version tag, and keeps Marketplace publishing behind the protected environment named
  `release`. Only that protected gate may read the named `VSCE_PAT` credential from the CI secret
  store after verification; it is never passed to build/test steps, printed, or persisted.
- [x] A release candidate test covers ordinary verification, version mismatch, missing CHANGELOG
  notes, license/SBOM diff, unexpected VSIX file, wrong branch, missing credentials, duplicate tag,
  and cancellation before publishing.

## Stage 22 Marketplace materials and smoke addendum (T2207)

These gates establish candidate evidence only. They do not authorize Marketplace publication,
credentials, a version/tag/release change, or a weaker replacement for the protected release gate.

- [x] `pnpm test:marketplace` passes for the exact candidate and confirms the reviewed icon, three
  sanitized screenshots, description, privacy/support links, known limitations, README parity, and
  exact media allowlist.
- [x] The manual Marketplace smoke workflow passes on Ubuntu, macOS, and Windows for one exact source
  revision. Each leg packages and installs its exact VSIX and retains only the bounded JSON evidence
  described in `docs/marketplace-smoke.md`.
- [x] The candidate evidence covers activation, loopback Provider configuration, deterministic
  multi-turn `list_files`/`read_file`, MCP invalid-configuration rejection/disconnect, delete/clear
  lifecycle registration and contracts, diagnostics export contracts, Agent view display, and
  structured logs without credentials or external model traffic.
- [ ] On the exact retained candidate, manually confirm the Provider/model labels and second-turn
  Tool result, Provider-key deletion, **Clear All Local Data** modal/retry path, and diagnostics
  preview/save/redaction path on the three supported operating systems. Record the workflow run URL
  and source commit without uploading user-data, logs, workspace content, conversations, or exports.
- [x] Independent archive inspection confirms no fixture, cache, temporary profile, private state,
  credential, conversation, diagnostics export, workspace data, or undeclared executable is present.

### Stage 21/22 candidate evidence (PR 270)

- Candidate source commit: `09854b3a1f36b074534b6a37a02212367eb6ecfa` on
  `codex/stage21-stage22-release-evidence`.
- Candidate VSIX: `.artifacts/ctrl-zebra-0.1.1-09854b3a1f36.vsix`; independent archive verification
  recorded SHA-256 `6c3e93009f8bc4cc2f26a93e3f655fb8f4c7f94501a377997f0884133332be45`, 15 allowed
  archive entries, 4,764,037 compressed bytes, and 8,547,956 uncompressed bytes.
- Marketplace Smoke workflow: [run 32373404894](https://github.com/yangzuo0621/ctrl-zebra/actions/runs/32373404894)
  passed on Ubuntu, macOS, and Windows; CI workflow: [run 32373404952](https://github.com/yangzuo0621/ctrl-zebra/actions/runs/32373404952)
  passed on the same source commit.
- Windows manual confirmation on the exact candidate covered installation/version `0.1.1`, Agent
  view and Provider/model labels, loopback Provider completion, the Provider-key delete confirmation
  and idempotent no-key result, Clear All Local Data modal/completion/reload to empty state, and
  diagnostics preview/save/redaction. The saved diagnostic sample contained only bounded metadata
  and no paths, prompt, Tool data, or secret.
- Remaining manual gates: Stage 21 release-environment failure/concurrency/running-operation cases,
  and the T2207 manual Provider/Tool/delete/clear/diagnostics confirmation on macOS and Linux. These
  remain unchecked until independently performed on those operating systems.
