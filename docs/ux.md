# CtrlZebra UX Contract

This document defines the current user paths, information architecture, and interaction contract
for the desktop VS Code Extension. Protocol, security, persistence, and module boundaries belong to
their respective owner documents; this document describes their visible product behavior.

## Experience goals

Users should not need to understand the Agent state machine to determine whether the workspace and
model are ready, send a question or coding task, understand progress and side effects, find the next
step after failure/cancellation/restart, or return to a recent Session and continue working. The
conversation and Composer are the default focus; Sessions, Checkpoints, diagnostics, and settings
appear only when relevant.

## Product language

- The Webview target language is English (`en`). Headings, controls, status, error, help, and screen
  reader copy use one consistent product vocabulary.
- `apps/webview/src/strings.ts` is the single owner of static Webview copy. Components, feature
  stores, and live regions use its values or formatting functions. Dynamic user input, model output,
  paths, Server names, and validated safe errors remain data and are not copied into the string catalog.
- A future additional language must be selected at one explicit locale boundary with complete coverage;
  components, Providers, and screen-reader-only text cannot switch languages independently.

## First use and Provider status

The first-use path is: open the sidebar → inspect configuration status → complete required setup → send
the first message → read the result. The empty state explains missing items, their purpose, and a direct
next action without exposing every implementation detail or implying unsupported capabilities.

- Onboarding receives only a strict Provider display projection: the active Provider identifier and
  `apiKeyConfigured`/`modelConfigured` booleans. It never displays a model ID, endpoint, Secret name,
  key fragment, or third-party response.
- Missing credentials expose “Save API key”; a missing model exposes “Select model”; “Open settings”
  remains available for endpoint, capability, or other configuration errors. A validated local loopback
  OpenAI-Compatible service may report that its credential requirement is satisfied. Credential delete
  and rotation are discovered only through Host-owned Command Palette commands.
- Save, select, and settings controls send strict intents for Host execution. Success, cancellation,
  and failure use separate fixed safe outcomes. Failure preserves the prior state and retry action;
  unavailable status is never treated as proof that a credential is absent.
- Empty-state controls are keyboard operable with visual-order focus. Refreshes and errors do not steal
  focus. At approximately 300px, 200% zoom, long copy, and all four VS Code themes, missing items,
  primary actions, and the Composer remain usable.

### Model selection and connection checks

- The Host reads configuration or starts a model-metadata request only after an explicit command.
  Opening the sidebar, restoring a Session, activation, sending a message, and Tool execution do not
  automatically fetch lists or check connections.
- Official lists show only bounded Provider model IDs. Missing credentials, empty lists, network or
  timeout failures, authentication failures, malformed responses, and unsupported custom endpoints
  offer manual model entry. Cancellation or failure does not write settings or clear an existing model.
- A connection check validates only context-free metadata. It sends no prompt, workspace, Session, Tool,
  or generation request. Authentication, model existence, streaming, and Tool Calling are shown as
  supported, unsupported, or unknown; unsupported or ambiguous facts are never guessed. Custom
  endpoints are not assumed compatible because of their name.
- Checks have a fixed timeout and no automatic retry. Success, authentication failure, missing model,
  rate limiting, timeout, network unavailability, malformed response, cancellation, and unknown use
  separate safe copy; failure and cancellation preserve all existing configuration.

## Conversation, Composer, and messages

- The Composer and current conversation are the primary visual region. The input has an accessible name;
  the default keyboard contract is `Enter` to send and `Shift+Enter` for a newline. Send, stop, and retry
  follow Run state, and disabled reasons are visible. Drafts survive configuration navigation, refresh,
  and non-terminal state updates.
- User, Agent, Tool, and system feedback are distinguished semantically, spatially, and with labels,
  not by color alone. The supported Markdown subset safely renders headings, lists, code, emphasis,
  quotes, tables, and absolute `http`/`https` links. Raw HTML, images, bare URLs, workspace files, and
  commands remain inert text. Long content keeps the bounded prefix and shows a stable shortened marker.
  Code supports keyboard copy with concise accessible feedback.
- Streaming does not steal focus, reset selection, or force a user who has left the bottom to scroll.
  Empty replies, cancellation, truncation, and no-content failure have distinct fixed messages. Partial
  answers are display content, not complete model history.
- Reasoning summaries appear only after actual non-empty summary text is received, remain separate from
  answer and Tool content, and follow source order. They are plain text, not Markdown, links, commands,
  or hidden chain-of-thought. New blocks start expanded; a user collapse is not overridden by later
  deltas. Partial/truncated states are visible, and the live region announces only discrete transitions.

### Composer management actions

- `New chat` is an explicit, keyboard-accessible primary action. It clears the current projection,
  selected Session, staged restore, and unsent Resource/Prompt/editor/file attachments without deleting
  saved Sessions. During an active Run, restore, or switch it is disabled or ignored while preserving
  the draft.
- The latest completed assistant answer exposes a scope-labelled “Regenerate response” action. Every
  completed user message exposes “Edit and resend”. Both use exact Session/message identities and create
  a fresh Run without replaying old Tools or approvals. The old branch remains visible until the new
  result completes; cancellation, failure, truncation, mismatch, and late events restore the old branch.

## Approvals, Tools, and side effects

Approval cards stay near their Tool card and answer: what will happen, what it affects, what the risk is,
and how it can be restored. While pending, the card shows the action, workspace-relative targets,
explicit risk, Diff or immutable details, and expiry; raw Tool JSON is hidden. Visual simplification
cannot hide immutable details required by the security contract.

- Tool details disclose progressively: action summary → resources/impact → parameters and output.
  Successful read-only results are compact; running, pending-approval, and failed states have higher
  priority. Truncation, cancellation, timeout, non-zero exit, denial, and execution failure remain distinct.
- File create, delete, rename, and multi-file edit show one-time `write` approval. A multi-file plan
  cannot be split into implicit per-file approvals. Users may open a Host-owned Diff with bounded
  before/after content but cannot edit it, force overwrite, or provide replacement content.
- Approve is enabled only when the complete Diff and current bound plan are ready. Target changes,
  Trust loss, expiry, cancellation, or Diff failure show “Not applied”; preflight failure explicitly
  says no files were modified, while apply failure retains the Checkpoint and a check/restore action.
- Restore is one explicit whole-operation action: create restores by removing the new file, delete by
  recreating the original, rename by restoring the original path, and multi-file edit by restoring the
  complete set. Any changed target conflicts with the whole operation. Cancellation, switching, New
  chat, and disposal do not create hidden retries or model actions.

## Failure, interruption, Sessions, and recovery

- User messages explain what happened, what did not happen, and the next safe action. Errors are not
  conveyed by color alone. Token warnings and limits show estimates and thresholds and state that they
  are local safety limits, not billing; an exceeded Run stops its current loop and a follow-up uses a new Run.
- The Session list shows recognizable titles, recent activity, and attention-worthy states. Selecting,
  restoring, or creating a Session never silently overwrites a draft or active Run. Restore displays
  history only and never resumes work automatically.
- Completed, truncated, cancelled, budget-exceeded, failed, and interrupted Sessions continue only when
  the user explicitly sends another message, which creates a fresh Run. A recognized legacy single-turn
  v1 Session opens as read-only history: deletion and `New chat` remain available, while Composer, edit,
  and regeneration are disabled.
- Failed, cancelled, truncated, and interrupted Runs retain the user question; incomplete assistant
  text is marked partial and is not inserted into the next Run. Complete Tool pairs may remain in order.
  Damaged records, orphan calls, and unknown Sessions show actionable errors and cannot be routed elsewhere.
- Session deletion affects only local CtrlZebra history, attributable Checkpoints, and temporary files.
  Clear-all explicitly explains that all local conversation and recovery records will be removed. The Host
  settles the Run before cleanup. Partial/unavailable results offer a fixed retry and never claim all data
  was removed; already deleted records remain deleted.
- Automatic retention runs only during an explicit history refresh, never on activation or sidebar open.
  Active or recovery-owned Sessions are not silently deleted; the UI exposes only bounded counts and safe copy.
- A Checkpoint appears only when recovery is meaningful and shows its target, operation, creation time,
  and safe-to-restore/conflict state. During local-data clearing, Session, approval, MCP, Provider, editor,
  and file-reference projections are invalidated together; late messages cannot restore cleared content.

## IDE context and workspace file references

IDE context and `@` file references are visible, removable, editable, ordinary untrusted context, not
hidden System instructions. Cards show fixed provenance, workspace-relative paths, language/range, Stale,
and Truncated state; they do not show absolute paths, raw URIs, or Provider objects.

- Capture happens only after explicit user action. Editor, selection, workspace, Trust, or version changes
  mark a card Stale; sending requires Refresh or an explicit Use stale decision. A collapsed selection
  preserves its exact empty range and does not fall back to the active line/file. Missing editors and
  unsafe results show fixed unavailable states.
- Diagnostics, definitions, references, and symbols appear as plain text near their message/Tool. They
  provide no Code Action, edit, execute, or approval controls. Mixed results filtered by workspace scope
  show a fixed omission message; fully filtered or malformed results show safe unavailability rather than
  an indistinguishable empty result.
- `@` suggestions support keyboard navigation, selection, and Escape. The Host reads files; the Webview
  never reads URIs or files. Equivalent canonical paths collapse to one card. A Stale card blocks sending
  until Refresh or Use stale file. New chat, switching, cancellation, and late reads do not change the draft.
- Editor entry is disabled by default and fills the Composer only after an explicit request for the active
  file or selection. It does not send, run the model, execute a Tool, write a file, or grant authority.
  Refresh, Remove, and Use stale preserve the draft and focus.

## Information architecture, visual design, and accessibility

The default order is current Session and Composer, messages and Tool state, current Run actions, pending
approval/recovery, and then history, Checkpoints, settings, and diagnostics. Secondary capabilities use
progressive disclosure; empty management regions are not permanently visible, and the page does not rely
on horizontal scrolling.

- Use VS Code CSS variables and existing semantic tokens; JavaScript must not detect theme names. Support
  light, dark, high-contrast, high-contrast-light, and `prefers-reduced-motion`.
- Every primary path is keyboard operable, with semantic names and visible focus. Streaming, refreshes,
  errors, and list changes do not unexpectedly move focus, reset selection, or scroll.
- State, risk, Stale, truncation, selection, and errors are not communicated only by color or icons.
  At approximately 300px, 200% zoom, and with long localized text, sources, primary actions, input, and
  fixed next steps remain visible and usable.
- Live regions announce discrete state changes only; they do not read every token, parameter, source,
  diagnostic item, or Server text.

## MCP user experience

MCP is a progressive-disclosure assistant to the conversation, not the default focus. The UI distinguishes
configured, connected, and authorized-for-one-operation states and never implies persistent authorization.

- Connection is always a user action: inspect settings → choose `modern-only`/`dual` → read the external
  process warning → approve or reject → inspect connection and capabilities. Activation, restore, sidebar
  open, and model text do not auto-start, reconnect, or fake progress.
- Negotiated era/version and capabilities appear only after a complete handshake. Configuration changes
  say that they take effect after disconnect/reconnect. Disconnect disables features before cleanup, and
  an untrusted workspace offers the safe Trust next step.
- Every MCP Tool shows Server provenance, exact name, bounded parameters, `execute` risk, and unknown
  local/network side effects, with separate per-call approval. There are no “always allow”, “allow this
  Server”, or batch buttons. Resource/Prompt browsing, confirmation, and attachment are explicit actions,
  not Tool approvals and never authorize follow-up operations.
- Resource and Prompt previews are plain text. A Prompt `assistant` role is provenance only, not trusted
  history. Disconnect, generation changes, sending, and refresh invalidate unconfirmed previews; attached
  snapshots are not silently replaced.
- Diagnostics distinguish skipped Tools, refresh failure with the prior catalog retained, connection
  failure, and a normal connection. Recovery is limited to Refresh tools, Reconnect, or Open settings;
  Schema, stderr, raw JSON-RPC, command, environment, and Server-error details are not shown. Incompatibility
  remains a failed state and does not expose probe or fallback internals.

## Change boundaries and current quality bar

UX work must not change Tool risk, approval binding/expiry, Trust, path validation, command execution,
Checkpoint recovery, credential access, telemetry/cloud synchronization, or Protocol/Persistence fields.
New cross-boundary behavior requires an update to its owner document first.

The current quality bar is: a first-time user can configure and start a conversation from the UI; primary
actions work in a narrow sidebar; every visible error has a fixed next step; streaming preserves focus and
scroll position; summaries are not announced token by token; no empty summary card appears without content;
and primary paths work with keyboard input, all four themes, and 200% zoom.
