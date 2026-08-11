# CtrlZebra Privacy Notice

Effective date: 2026-08-03

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
- The selected Provider model ID is stored in the existing VS Code machine setting. A model list
  fetched for an explicit selection command is transient; list responses are not persisted, cached,
  or copied into Session data, Webview state, diagnostics, or logs.
- Session manifests, messages, and lifecycle events are stored in the extension storage directory.
- Checkpoints are stored in extension storage before approved file changes. They contain the exact
  pre-edit UTF-8 workspace text needed for conflict-safe restoration.
- Bounded structured diagnostics are written to the local CtrlZebra VS Code log channel. They contain
  event categories, outcomes, durations, process RSS samples, and correlation identifiers; they
  exclude prompts, responses, file contents, command output, paths, credentials, and raw third-party
  errors.
- The optional MCP Server configuration remains in VS Code machine settings. Live MCP catalogs,
  executable details, environment values, raw protocol messages, stderr, Server errors, and process
  handles are not copied into Session storage, Webview state, model context, or logs.

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
- bounded text from an MCP Resource that the user explicitly previews and attaches, a Prompt that
  the user explicitly previews and confirms, and results from individually approved MCP Tool calls.

The provider may process and retain this data under its own terms and privacy policy. CtrlZebra does
not proxy provider traffic or receive a copy. Users are responsible for selecting an appropriate
provider and must not send confidential data unless that provider and account are authorized for it.
A loopback OpenAI-compatible endpoint keeps the network destination local, but the behavior of that
local service remains outside CtrlZebra's control.

## User-triggered model discovery

When a user explicitly runs the model-selection command, the Extension Host may send a metadata-only
HTTPS `GET` request to the fixed official OpenAI or Gemini model-list endpoint. The request uses the
selected Provider's API key as an authorization header and contains no prompt, workspace path or
source text, Session, message, Tool definition, Tool input, or Tool result. The provider can observe
and retain this request under its own terms, just as it can observe other authenticated API traffic.
CtrlZebra does not proxy or receive a copy of the response beyond the local selection flow.

No model-list request is made during activation, Webview creation, Session recovery, or chat execution.
OpenAI-Compatible and custom endpoints are not queried automatically because their list behavior and
data handling are not covered by the official Provider guarantees; users enter those model IDs
manually. Cancelling or failing discovery leaves the existing model setting unchanged.

## User-triggered Provider connection checks

When a user explicitly runs the Provider connection-check command, the Extension Host may send one
bounded, metadata-only request to the documented model-metadata endpoint for the active OpenAI or
Gemini configuration. The request contains only the selected Provider/model identifier and the
matching SecretStorage authorization header. It contains no prompt or instructions, workspace path
or source text, Session/messages, Tool definition, Tool input/result, or other model context, and it
does not ask the model to generate output or execute a Tool. The response is used transiently to
classify authentication and model existence and any capability fields that the official contract
explicitly exposes; unsupported or ambiguous capability facts are shown as unknown rather than
inferred.

Custom Provider endpoints and OpenAI-Compatible endpoints are not assumed to implement the OpenAI
metadata route or authorization contract, so the check does not guess an undocumented request. It
reports unknown for facts that cannot be safely verified. The request has a fixed timeout, no retry,
and cancellation stops the local flow without changing configuration. Response bodies, headers,
authorization material, SDK errors, and endpoint details are not persisted, logged, sent to the
Webview, or retained by CtrlZebra. The configured provider service may observe and retain the
metadata request under its own terms and privacy policy.

## Workspace access and commands

Read tools access only canonical UTF-8 text inside the single selected workspace. File changes and
commands require a trusted workspace and a fresh operation-bound approval. An approved command runs
locally with a minimal environment allowlist and shell interpretation disabled. The command itself
may transmit data if its executable and arguments request network or external-system access;
CtrlZebra does not add a second consent or privacy layer beyond the exact command approval.

An explicitly configured local MCP Server is a separate external process running with the user's
operating-system authority. It may independently access local files, network services, or other
data according to its own implementation. CtrlZebra starts it only in a trusted single-folder
workspace after an exact startup approval, supplies only a minimal environment allowlist, and does
not inject credentials. Every MCP Tool call requires a separate exact single-use approval, but
Resource reads and Prompt retrieval are user-selected context operations rather than operating-system
sandbox controls. Users must review the Server software and any privacy terms before configuring it.

## Security and disclosure

Credentials must be entered only through a supported password-masked command. Users should not paste
credentials, private source, prompts, or logs into public issues. Security-sensitive reports should
be shared privately with the maintainer when a private reporting channel is available on the
repository.

## Changes to this notice

Material changes to collection, external transmission, persistence, telemetry, accounts, or cloud
services require an implementation-plan and security review before code changes. The effective date
above will be updated when this notice materially changes.
