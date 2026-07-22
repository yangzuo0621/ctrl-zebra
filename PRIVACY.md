# CtrlZebra Privacy Notice

Effective date: 2026-07-22

This notice describes the data behavior of the Phase 1 CtrlZebra desktop VS Code extension. It does
not replace the privacy terms of Visual Studio Code, the operating system, a model provider, or a
service that a user chooses to run through a command.

## Data controller and contact

CtrlZebra is an open-source project maintained by Zuo Yang. Privacy questions and security reports
can be submitted through the repository's GitHub issue tracker. Do not include API keys, private
source code, prompts, logs, or other sensitive data in a public issue.

## Data CtrlZebra does not collect

CtrlZebra has no project-operated account service, advertising, analytics, telemetry, cloud sync, or
remote logging backend. The project does not receive an automatic copy of prompts, model responses,
workspace files, Sessions, Checkpoints, diagnostics, or credentials.

## Data stored locally

The Extension Host stores data using VS Code-owned facilities on the user's machine:

- Provider API keys are stored in VS Code SecretStorage. They are excluded from settings, Webview
  state, Session persistence, Checkpoints, logs, tests, and model-visible content.
- Session manifests, messages, and lifecycle events are stored in the extension storage directory.
- Checkpoints are stored in extension storage before approved file changes. They contain the exact
  pre-edit UTF-8 workspace text needed for conflict-safe restoration.
- Bounded structured diagnostics are written to the local CtrlZebra VS Code log channel. They contain
  event categories, outcomes, durations, process RSS samples, and correlation identifiers; they
  exclude prompts, responses, file contents, command output, paths, credentials, and raw third-party
  errors.

CtrlZebra currently has no automatic Session or Checkpoint retention period, pruning policy, or
in-product delete control. Data remains subject to VS Code's extension-storage lifecycle and any
manual storage management performed by the user.

## Data sent to a configured model provider

Starting a chat sends data directly from the Extension Host to the provider endpoint selected in VS
Code settings. Depending on the conversation, this can include:

- the user's prompt and relevant prior conversation messages;
- tool definitions and bounded tool results;
- model responses needed to continue a tool loop; and
- workspace source text returned by an approved read operation or other tool result.

The provider may process and retain this data under its own terms and privacy policy. CtrlZebra does
not proxy provider traffic or receive a copy. Users are responsible for selecting an appropriate
provider and must not send confidential data unless that provider and account are authorized for it.
A loopback OpenAI-compatible endpoint keeps the network destination local, but the behavior of that
local service remains outside CtrlZebra's control.

## Workspace access and commands

Read tools access only canonical UTF-8 text inside the single selected workspace. File changes and
commands require a trusted workspace and a fresh operation-bound approval. An approved command runs
locally with a minimal environment allowlist and shell interpretation disabled. The command itself
may transmit data if its executable and arguments request network or external-system access;
CtrlZebra does not add a second consent or privacy layer beyond the exact command approval.

## Security and disclosure

Credentials must be entered only through a supported password-masked command. Users should not paste
credentials, private source, prompts, or logs into public issues. Security-sensitive reports should
be shared privately with the maintainer when a private reporting channel is available on the
repository.

## Changes to this notice

Material changes to collection, external transmission, persistence, telemetry, accounts, or cloud
services require an implementation-plan and security review before code changes. The effective date
above will be updated when this notice materially changes.
