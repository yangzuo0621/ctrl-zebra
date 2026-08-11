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

## Product Language and String Ownership (T1701)

- The Marketplace target language is English (`en`). This is a minimum-localization policy: T1701 does not
  add runtime locale negotiation, a localization service, or a translation dependency.
- `apps/webview/src/strings.ts` owns every static user-visible Webview string, including headings, control
  names, status and error copy, placeholders, and screen-reader labels/announcements. Components and feature
  stores import that module instead of defining parallel literals. Formatting functions in the module may insert
  bounded state values, identifiers, or counts without changing the selected language.
- Dynamic user/model content, workspace paths, MCP names, and validated Host error details remain data. They are
  rendered as text and are never guessed, translated, or treated as string-catalog entries. A dynamic value must
  not provide an ARIA label or live-region policy by itself.
- Visible text, ARIA names, polite status announcements, and actionable errors use the same English vocabulary.
  A component may not introduce a second language for a screen-reader-only label or a transient state. Any future
  locale must be selected at one boundary and provide complete coverage before it is exposed.

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
  projection reusing that action's `requestId`. The Webview accepts the post-action projection only
  after the matching terminal action outcome for its pending action; a normal status request uses
  only its own `requestId`. Malformed, stale, or mismatched responses are ignored after Protocol
  Schema validation.
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

## Answer Markdown Rendering (T1702)

- `MarkdownMessage` consumes the current validated assistant/user text projection and parses it with
  the pinned `markdown-it` configuration. It renders parser tokens as a fixed React tree; it never
  emits parser HTML or uses `dangerouslySetInnerHTML`, `innerHTML`, or a browser HTML parser.
- Dependency record (audited 2026-08-11): [`markdown-it@14.3.0` npm metadata](https://registry.npmjs.org/markdown-it/14.3.0)
  identifies the MIT license, the `14.3.0` release published 2026-07-02, and the upstream
  [markdown-it repository](https://github.com/markdown-it/markdown-it). It is the latest 14.x
  release; the upstream project is active (15.0.0 was published 2026-07-30), so this task pins the
  compatible 14.x line rather than an unbounded range. The package exports ESM/CJS entry points,
  declares no Node engine floor, and the repository's Vite Webview build plus browser-like Vitest
  suite exercise the runtime path. No syntax-highlighting or remote-resource plugin is added; the
  companion `@types/markdown-it` package is development-only.
- Auditable size measurement from the same npm metadata and `pnpm build` (2026-08-11): the registry
  tarball is 453,201 bytes (63 files) and unpacks to 1,679,991 bytes. The generated Webview bundle
  is `main.js` 461,505 bytes (Vite-reported gzip 149.53 kB), alongside 27,804-byte CSS and a
  362-byte HTML shell. The bounded parser/token projection keeps retained message trees
  proportional to the existing message limit; rerun `pnpm view markdown-it@14.3.0 dist --json` and
  `pnpm build` to reproduce the record after an upgrade.
- The supported technical subset is headings, ordered/unordered lists, fenced or indented code,
  inline code, emphasis, block quotes, tables, and links. Raw HTML, images, automatic bare-URL
  linking, remote resources, and unsupported extensions remain escaped or inert text.
- Only absolute `http`/`https` links are actionable. The component prevents default navigation and
  sends the exact bounded destination through `WebviewHost.openExternal`; the Extension validates
  it again and owns `vscode.env.openExternal`. No link can open a workspace file, command, Webview
  route, or unapproved URI scheme.
- Rendering applies the shared 262,144-code-point/1,048,576-byte prefix bound before parsing and
  shows a stable shortened marker when the bound is reached. Stream updates preserve deterministic
  block keys, code-copy focus, and text selection; unfinished fences are treated as the current
  display projection and do not gain side effects. Cancellation or terminal completion accepts no
  later delta and therefore cannot trigger a late link or copy action.
- Code blocks expose a keyboard-operable Copy button. Clipboard success/failure is local UI state,
  does not move focus, and never writes code to the Extension message protocol. Reasoning, MCP
  Resource, Prompt, and Tool content intentionally bypasses this renderer and stays plain text.

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
- The presentation uses a semantic region labelled “Reasoning summary” with a concise Provider-source label.
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

This boundary renders the validated stage 14/T1804 MCP projection and does not negotiate protocol or
capabilities in the browser. Modern/legacy selection, configuration migration, probing, fallback,
and SDK lifecycle remain Host-owned.

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
- The connection snapshot always carries the validated configured mode (`modern-only` or `dual`). It
  carries `negotiated: { era, version }` only for a connected state, where the closed pairs are
  `modern / 2026-07-28` and `legacy / 2025-11-25`. Connecting, disconnecting, disconnected, and
  failed states expose neither a selected era nor usable capabilities. The store never infers a
  negotiated value from the configured mode, diagnostics, catalog contents, or a prior connection.
- A version-1 configuration is presented as modern-only until the user explicitly migrates it to
  version 2. The browser cannot edit the setting object or request migration by carrying a command,
  environment, credential, raw JSON, or mode override; `open-settings` remains a Host-owned intent.

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

### MCP diagnostics and recovery (T1803)

The MCP feature store owns one validated, generation-bound diagnostic projection in addition to the
connection and catalog snapshots. It accepts only strict `extension/mcp-diagnostics` messages with
the active Server identity, generation, and Host-owned `diagnosticSequence`. A lower sequence, wrong
scope, exact duplicate, same-sequence conflict, malformed payload, cancellation, disconnect, or
post-terminal message is ignored before state mutation. A successful Tool catalog replacement and
its diagnostic replacement are rendered as separate complete values; the diagnostic is never treated
as a second catalog half. A `clear` projection removes stale reasons synchronously while leaving the
accepted catalog intact.

The connection projection is an independent cleanup fence. When the store receives
`extension/mcp-connection` with `disconnecting`, `disconnected`, or `failed`, or a connected
projection for a different Server/generation, it synchronously clears the diagnostic list,
truncation marker, pending diagnostic sequence, pending `refresh-tools` request, recovery controls,
and diagnostic live-region text before applying the new connection state. This also covers the
non-connected/failed projections emitted for cancellation, Workspace Trust loss, and disposal; the
store never waits for a `kind: "clear"` message. If a refresh is cancelled while the connection
remains connected, the Host emits `kind: "clear"` and the store invalidates the pending request.
Late messages cannot recreate diagnostics or recovery controls. A normal connected projection with
an empty diagnostic replacement renders no diagnostic region or recovery action.

The panel renders only fixed localized text selected from the closed reason/code/action unions. It
shows bounded skipped Tool names and reasons, a stable truncation marker, and one explicit recovery
control (`Refresh tools`, `Reconnect`, or `Open settings`) appropriate to the projection. It never
renders Schema values, keyword paths, JSON-RPC/SDK errors, commands, arguments, environment, stderr,
stack traces, credentials, or arbitrary Server metadata. A protocol-incompatible diagnostic renders
the configured mode, its closed supported-version list, and the next step while the connection status
remains failed; no probe/fallback/negotiated-success, timeout, timing, or Server-error text is inferred
in the Webview. A successful connected snapshot renders the negotiated era/version separately and
never rewrites it as modern because the configured mode is dual.

The store validates the union combinations before rendering: degraded and refresh-all-rejected
diagnostics are connected and expose only `Refresh tools`; initial all-rejected and initial
whole-operation failures are failed and expose only `Reconnect`; refresh whole-operation failures
are connected and expose only `Refresh tools`; protocol incompatibility is failed and exposes only
`Open settings`; `clear` exposes no recovery action. Independent fields are never combined into a
new action.

Recovery controls dispatch only their strict Host intents. `Refresh tools` uses the current connected
generation and does not start a process or reuse approval; `Reconnect` and `Open settings` reuse the
existing explicit Host flows. Controls are disabled with a visible reason when the connection or
generation is not eligible. Refresh success clears diagnostics and preserves focus; failure retains
the last complete catalog and replaces only the bounded diagnostic state. One polite live region
announces a discrete diagnostic replacement, clear, or recovery failure once; the diagnostic list is
not itself a live region, so names and reasons are never read item-by-item. Keyboard focus, text
selection, disclosure state, and scroll position remain stable during polling, refresh and stale
message rejection. Normal connected operation with no diagnostics follows the same path without a
diagnostic announcement or recovery control.

### Dual-era display and migration (T1804)

The Webview renders configured mode as a setting fact and negotiated era/version as a successful
connection fact. It uses fixed localized labels for `modern-only`, `dual`, `modern / 2026-07-28`, and
`legacy / 2025-11-25`; it never renders SDK enums, raw discovery/initialize data, probe timing,
fallback attempts, or a guessed era. A version-1 setting is described as modern-only and exposes an
`Open settings` path for the explicit migration to version 2; no Webview message carries a mode
override or a configuration object.

The connection card keeps the configured mode visible while `connecting`, but shows no negotiated
version or capabilities until `connected`. A failed connection exposes only the stable error,
closed supported-version list, and fixed next action. Disconnect, cancellation, trust loss, cleanup
failure, generation change, or configuration staleness clears the negotiated pair and all dependent
catalog/recovery state synchronously. This is a presentation rule; the Extension remains the sole
owner of negotiation, migration, process cleanup, and capability decisions.
