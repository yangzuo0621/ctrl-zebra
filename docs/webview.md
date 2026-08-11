# Webview Guidelines

This document defines the React Webview constraints established before T0103. It complements the dependency and lifecycle rules in `AGENTS.md` and applies to the desktop VS Code Webview only.

## State Ownership

- The Extension Host owns workspace access, secrets, model clients, persistence, approvals, and every operation that requires VS Code capabilities.
- The Webview owns presentation state and user interaction state. Feature stores own shared client state; React components own only short-lived state that has no meaning outside the component.
- Persisted or Extension-authoritative values are represented as validated protocol DTOs when the protocol is introduced. The Webview must not invent a second authoritative copy.
- Derived display values are computed from the owning state instead of synchronized through duplicate state variables.

## Session and Run ownership

- The chat store owns only the current validated display projection and the user's interaction state.
  The Extension Host owns Session identity, persistence, Run allocation, model history, approvals,
  cancellation, and all resource invalidation.
- A submit carries the current Session identity when one is selected. An omitted identity means the
  Host creates a new Session; the Webview never invents a Session or Run ID. Every accepted submit is
  one fresh Run, and live messages are applied only when their `requestId` belongs to the active Run
  and their Session projection still matches.
- `New chat` is an explicit reset action. When no Run or restore is active, the store clears its
  transcript, selected Session, staged restore, live reasoning, pending Tool/approval display, and
  stale attachment presentation before the next submit. It does not delete persisted history. During
  a Run, restore, or Session switch the action is disabled or ignored without retargeting ownership.
- A Session switch or restore is transactional: stage only validated messages/reasoning for the exact
  request and Session, then commit them together. Errors, mismatches, disposal, or a newer request
  discard staged data and leave the current projection intact. A restored `interrupted` Session is
  display-only until the user explicitly submits a new Run.

## VS Code API Boundary

- `acquireVsCodeApi()` is called in exactly one Webview-local adapter module when host messaging is introduced.
- Components and stores depend on a narrow adapter contract and never access the global VS Code API directly.
- The acquired API object is not placed on `window`, serialized, logged, or passed through component props.
- Webview code has no direct filesystem, secret, command, model, or workspace capability. Those operations remain behind validated Extension messages.

## Component Responsibilities

- Page components compose feature regions and accessible landmarks.
- Feature components translate user interaction into store or adapter actions and render observable state.
- Reusable presentation components receive data and callbacks through typed props and do not acquire host capabilities.
- Components do not parse protocol envelopes, perform persistence, or contain Extension workflow decisions.

## Provider Onboarding Projection

- The Extension Host remains the source of truth for Provider settings, model selection, and
  SecretStorage. The onboarding region consumes only the validated T1603 `extension/provider-status`
  projection: the closed active Provider enum plus `apiKeyConfigured` and `modelConfigured`
  booleans. It never receives an endpoint URL, model ID, Secret reference, credential value, key
  length/prefix/suffix, authorization material, or raw Provider response.
- On mount, the feature requests the projection through the strict `webview/provider-status`
  message. Save-key, select-model, and open-settings controls send separate intent-only messages;
  they do not invoke VS Code APIs or carry Provider/Secret arguments. The Host maps those intents to
  its existing command workflows and sends a correlated bounded action outcome, then a fresh status
  projection. The Webview ignores malformed, stale, or mismatched responses after Protocol Schema
  validation.
- `apiKeyConfigured: false` is rendered as a missing credential requirement, not as a prompt to
  inspect or replace a value. The Host may report it as configured for a validated local
  OpenAI-Compatible endpoint that does not require a key. The Webview never infers credential state
  from model text, labels, endpoint strings, or error wording.
- Onboarding actions are semantic, keyboard-operable buttons with accessible names and visible
  focus indicators. A status refresh, command completion, cancellation, or error preserves the
  active control and does not auto-focus another region. After an action settles, focus returns to
  its trigger; if that control is no longer rendered, focus moves once to the onboarding heading.
  A polite status region announces only the discrete outcome, while actionable failures expose a
  stable user-safe message and keep the retry controls available. Cancellation leaves the previous
  projection unchanged and does not announce failure.
- The empty-state layout keeps the composer and its primary action reachable at approximately
  300px width, 200% zoom, and long localized labels. It uses the existing VS Code CSS variables and
  semantic tokens for light, dark, high-contrast, and high-contrast-light themes; state is never
  communicated by color alone and no page-level horizontal scrolling is introduced.

## Styling and Theme Integration

- Component styles use CSS Modules. Global rules are limited to the application root and document defaults required by the Webview shell.
- Theme-dependent colors, fonts, borders, focus indicators, and other host-integrated values use VS Code CSS Variables with safe fallbacks only where VS Code does not guarantee a value.
- Styles must work with light, dark, high-contrast, and high-contrast-light themes without detecting theme names in JavaScript.
- Motion and transitions respect `prefers-reduced-motion`.

## Accessibility

- Use semantic HTML before adding ARIA. Every interactive control must have an accessible name and be operable by keyboard.
- Focus indicators remain visible. Rendering updates must not steal focus or reset the user's current selection.
- Status, progress, errors, and streaming completion are exposed with appropriate live-region semantics without announcing every token.
- Text and controls must remain usable at VS Code zoom levels and with long localized content.

## Streaming Rendering

- The feature store owns streamed message assembly. Components render store snapshots and do not concatenate deltas in local component state.
- Stream deltas are batched to avoid a React render for every token while preserving visibly incremental progress.
- Existing message elements keep stable keys. Updates change only the active message and must not replace the complete transcript tree.
- Cancellation and completion flush the final owned state exactly once. No deltas may render after cancellation or terminal completion.
- Streaming updates must not move keyboard focus, repeatedly announce token fragments, or force scrolling when the user has moved away from the newest content.
- Failed, cancelled, interrupted, and truncated partial assistant content remains display-only and is
  labelled as partial/unfinished where applicable; it is not assumed to be complete model history.
  A subsequent Run appends to the validated Session projection only after the Host has rebuilt bounded
  history.

## Reasoning Summary Rendering

- The chat feature store, not a React component, owns reasoning assembly. It keys live blocks by the
  active `requestId` plus `blockId`, validates lifecycle before mutation, and stores ordered block
  snapshots containing content, completion/partial state, truncation, and the user's expanded state.
  Components receive snapshots and callbacks only; they never concatenate reasoning deltas locally.
- The store accepts only protocol-validated events for the active request. A start creates
  non-visible state; the first retained non-empty delta makes the block visible and initially
  expanded. An empty completed block is removed. Duplicate, mismatched, stale, ended, or
  post-terminal events are ignored without creating UI state.
- Deltas are queued in source order and flushed to one immutable store update no more than once per
  animation frame and no later than 50 milliseconds while visible. Completion, cancellation,
  failure, disposal, and Session replacement cancel the owned scheduler and perform at most one
  final synchronous flush. The scheduler has one explicit owner and idempotent cleanup.
- Store assembly repeats the Protocol block count, code-point, and UTF-8 limits as defense in depth.
  It never joins the complete unbounded stream before measuring it. Structured
  `extension/reasoning-limit` and end `truncated` values are authoritative; a client-side defensive
  cut can only make truncation stricter and must surface the same visible omission state.
- A terminal run marks every still-open, non-empty block partial and then rejects later events.
  Normal end marks only the matching block complete. Terminal state does not change a live block's
  current expanded choice. The store stages a validated `extension/reasoning-restored` snapshot and
  commits it only with the immediately following matching `extension/session-restored`; an error,
  mismatch, Session switch, or disposal discards it. Restored complete and partial blocks are
  ordered by their persisted sequence and default to collapsed; an empty snapshot renders nothing,
  and restoration never replays start/delta animations or live announcements.
- The presentation uses a semantic region labelled “推理摘要” with a concise Provider-source label.
  Each visible block has a keyboard-operable disclosure button with an accessible name and
  `aria-expanded`; new deltas never force a user-collapsed block open. Stable block keys prevent
  transcript replacement, focus loss, and text-selection reset.
- Reasoning content is rendered as plain selectable text with preserved whitespace and wrapping.
  It is not passed to the answer Markdown renderer and does not activate links, HTML, commands, URI
  handling, or remote resources. Copy controls copy only the bounded visible block and announce
  success without moving focus.
- One separate polite status region announces only discrete changes such as summary start,
  completion, partial termination, or truncation. The content container is not a live region, so
  token batches are not spoken. Status text is deduplicated per block and Run.
- Transcript auto-follow uses the existing bottom-proximity decision. Reasoning height changes may
  follow only while the user remains at the bottom; they do not scroll when the user is reading
  earlier content. Expanding or collapsing a block is user-controlled and must not trigger an
  unrelated focus or scroll jump.
- Layout and styles use existing semantic tokens and VS Code CSS variables. The disclosure header,
  source, progress, truncation/partial labels, content, and copy control wrap without horizontal
  page scrolling at approximately 300px width, 200% zoom, long localized labels, and all four
  supported VS Code theme classes. State is never communicated by color or motion alone.

## Provider Usage Rendering

- The chat store owns the validated `extension/token-usage` projection and accumulates each present
  field independently for the active Session while a Run is processing. Missing input, output, or
  total values remain unknown; the Webview never derives one field from another and never displays
  prices, billing, or estimates.
- The projection is Session-cumulative: a continuation keeps the prior validated counts and adds the
  next Run's actual fields; New chat clears the projection. The shared bounded merge rejects a
  cumulative overflow instead of clamping it, marks the live projection unavailable, and keeps that
  unavailable latch through terminal completion and continuation Runs; successful restore resets it.
- Usage is shown in a semantic Provider-usage region after a response. Complete actual counts are
  labelled normally; partial counts are labelled partial and unknown fields use an explicit em dash.
  A terminal response without any Provider count says that usage is unavailable rather than showing
  a fabricated zero. The component is presentation-only and receives store snapshots through props.
- Live Usage is accepted only for the active request while preparing or streaming. Terminal,
  cancellation, Session replacement, stale request, duplicate, and malformed messages cannot mutate
  the display. A restored Session commits its bounded Usage projection atomically with the validated
  `extension/session-restored` payload, and New chat clears it with the rest of the projection.

## Build and Resource Boundary

- Vite builds the React application into reproducible static assets under the Extension build output.
- The Extension constructs the complete Webview HTML document and converts every local script or stylesheet URI with `webview.asWebviewUri`.
- The Webview entry uses React's client `createRoot` API and contains no Extension activation side effects.
- Content Security Policy, nonce generation, and minimal `localResourceRoots` are owned by T0104 and are intentionally not defined by this task.

## MCP Rendering and State Boundary

This boundary renders only the stage 14 MCP `2026-07-28` projection and does not negotiate protocol
or capabilities in the browser.

- One MCP feature store owns the current validated connection snapshot and generation-bound Tool,
  Resource, Resource Template, Prompt, Resource preview, and Prompt preview snapshots. Components
  receive immutable projections and callbacks; they do not parse JSON-RPC, compile Tool schemas,
  join pages, decide capabilities, assign risk, validate external arguments, or own Server cleanup.
- The store accepts only Protocol-validated messages matching the current Server identity,
  generation, and active request. A complete catalog message atomically replaces its prior catalog.
  Stale, duplicate, malformed, post-disconnect, or post-terminal updates are ignored and cannot
  recreate controls or retained content.
- Connection generation change or disconnect synchronously disables live actions and clears
  catalogs, pending Tool availability, Resource previews, and unconfirmed Prompt previews. It does
  not mutate immutable Resource or confirmed Prompt attachments already owned by the Composer or
  persisted transcript.
- MCP state is Extension-authoritative and is never placed in `getState`/`setState` as a reconnect
  instruction. Webview restoration may retain only presentation choices such as an expanded catalog
  section; it does not retain a connected flag, capability, approval, generation, preview, or Server
  content as authoritative state.

MCP descriptors, annotations, Tool results, Resources, and Prompts are rendered through React text
interpolation. They never reach `dangerouslySetInnerHTML`, the answer Markdown renderer, command or
URI handlers, image/media elements, `asWebviewUri`, dynamic styles, or remote fetch. Server icon and
website fields are not part of the Protocol projection. Stage 14 adds no CSP source, connection,
frame, media, image, font, or `localResourceRoots` expansion.

The Server panel uses progressive disclosure and preserves chat and Composer priority. Connection
state, configuration-stale state, capabilities, cleanup failure, and errors use semantic text in
addition to visual tokens. Resource and Prompt catalogs use bounded semantic lists with stable keys
from their projected identities; list replacement preserves focus only when the exact item remains,
otherwise focus moves to the catalog heading with one deduplicated explanation.

External Tool cards reuse the existing Tool and Inline Approval components through a strict source
projection. An MCP source region shows Server, exact Tool name, fixed `execute` risk, and the unknown
local/network side-effect warning. Pending approval still replaces raw parameter detail with the
immutable approval presentation; MCP annotations never hide that region or change component policy.

Resource previews and Prompt previews are separate labelled regions with explicit attach/confirm and
cancel controls. Resource text uses a wrapping plain-text container with selectable preserved
whitespace. Prompt messages show source roles as provenance labels but are not rendered as chat
roles. Preview content is never a live region; only one status region announces discrete readiness,
attachment, confirmation, invalidation, failure, and connection transitions.

All MCP controls use semantic elements, visible focus, accessible names, and disabled-state reasons.
Disclosure state uses `aria-expanded`; forms associate labels, required state, validation messages,
and descriptions without relying on placeholders. Layout uses existing semantic tokens and VS Code
variables, wraps long unbroken identities, and remains operable at approximately 300px width, 200%
zoom, reduced motion, and light, dark, high-contrast, and high-contrast-light themes without
horizontal page scrolling or color-only state.
