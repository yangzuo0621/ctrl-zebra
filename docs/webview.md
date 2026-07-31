# Webview Guidelines

This document defines the React Webview constraints established before T0103. It complements the dependency and lifecycle rules in `AGENTS.md` and applies to the desktop VS Code Webview only.

## State Ownership

- The Extension Host owns workspace access, secrets, model clients, persistence, approvals, and every operation that requires VS Code capabilities.
- The Webview owns presentation state and user interaction state. Feature stores own shared client state; React components own only short-lived state that has no meaning outside the component.
- Persisted or Extension-authoritative values are represented as validated protocol DTOs when the protocol is introduced. The Webview must not invent a second authoritative copy.
- Derived display values are computed from the owning state instead of synchronized through duplicate state variables.

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

## Build and Resource Boundary

- Vite builds the React application into reproducible static assets under the Extension build output.
- The Extension constructs the complete Webview HTML document and converts every local script or stylesheet URI with `webview.asWebviewUri`.
- The Webview entry uses React's client `createRoot` API and contains no Extension activation side effects.
- Content Security Policy, nonce generation, and minimal `localResourceRoots` are owned by T0104 and are intentionally not defined by this task.
