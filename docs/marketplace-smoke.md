# Marketplace Materials and Smoke Evidence

This document owns the T2207 Marketplace listing and representative smoke-evidence contract. It
does not authorize a version change, tag, release, credential configuration, or Visual Studio
Marketplace publication.

## Listing materials

The extension manifest and packaged README provide:

- the reviewed 256x256 CtrlZebra PNG icon, dark gallery banner, concise description, repository,
  homepage, MIT license, and public issue tracker;
- three static screenshots under `apps/extension/media/marketplace/` showing the Agent overview,
  loopback Provider setup, and reviewable Tool/MCP controls;
- direct privacy, security, support, contribution, changelog, and known-limitation links; and
- an explicit statement that Marketplace publication is a separate release action.

The existing icon and generated screenshots are project-owned assets distributed under the
repository MIT License. The screenshots contain only invented UI values: no real account,
credential, workspace path, conversation, repository content, or captured local state.
`pnpm test:marketplace` checks the metadata, README parity, PNG type/dimensions/size, public links,
workflow pins/restrictions, and inclusion in the exact VSIX allowlist.

## Three-platform workflow

`.github/workflows/marketplace-smoke.yml` is a manual `workflow_dispatch` matrix for
`ubuntu-latest`, `macos-latest`, and `windows-latest`. Each leg uses Node.js 24.19.0 and the
repository-pinned pnpm version, with all Actions fixed to full commit SHAs and `contents: read` only.
It reads no secret and never publishes.

A successful leg performs, in order:

1. frozen dependency installation and Marketplace metadata/asset validation;
2. `pnpm package:vsix` with `CTRL_ZEBRA_MARKETPLACE_SMOKE=1`, which runs the repository checks and a
   deterministic loopback OpenAI-compatible integration covering one Session, `list_files`,
   `read_file`, and a second turn without a credential;
3. exact VSIX installation into isolated temporary extension/user-data directories;
4. installed activation, loopback Provider configuration/connection, MCP invalid-configuration
   rejection and disconnect, deletion/clear command registration, Agent view focus, and structured
   log checks; and
5. upload of one bounded JSON evidence file containing only task, source revision, runner OS, stable
   pass/fail labels, and `containsPrivateState: false`.

The package step runs the full unit suite on every matrix leg. Existing deletion, complete local-data
clear, diagnostics export, redaction, size-bound, cancellation, and save-port tests therefore remain
part of each platform result; the installed smoke additionally proves the public lifecycle commands
are registered in the packaged extension.

## Acceptance evidence map

| T2207 path | Automated evidence | Release-candidate confirmation |
|---|---|---|
| Installation and activation | Exact VSIX install/list plus activation and structured-log checks | Open the retained candidate from the same revision |
| Provider configuration | Loopback metadata server, machine-scoped settings, and connection report | Confirm the onboarding labels match the configured Provider/model |
| Multi-turn and file Tools | Deterministic Provider drives `list_files`, `read_file`, completion, and Session continuation | Confirm Tool state and second answer are visible in the Agent view |
| MCP restrictions | Installed invalid configuration is rejected and explicit disconnect completes | Confirm no Server starts without valid configuration, Trust, and fresh approval |
| Deletion | Unit contracts plus packaged delete/clear command registration | Exercise Provider-key delete and **Clear All Local Data** modal; retry any partial category |
| Diagnostics export | Builder/controller/save-port tests enforce bounds and redaction | Preview, confirm, save, and inspect a local export containing no path, prompt, Tool data, or secret |
| Artifact privacy | Exact selected/archive allowlists and bounded JSON evidence | Inspect the retained VSIX/evidence before publication |

Human-facing modal and save-dialog confirmation cannot be automated through an installed Extension
Host without adding a product test bypass. Record those confirmations in the release checklist for
the exact candidate revision; never treat a workflow run from another revision as evidence.

## Evidence handling

- Do not upload VS Code user-data, extension storage, logs, fixtures, caches, screenshots captured
  from a developer machine, Provider responses, conversations, workspace files, or credentials.
- Evidence is revision-specific. Record the workflow run URL and exact source commit after all three
  matrix legs pass.
- A failed, cancelled, or skipped leg is not three-platform evidence. Re-run the exact candidate or
  record the blocker without weakening the matrix.
- Actual Marketplace publication remains governed by the protected release process and separate
  explicit authorization.
