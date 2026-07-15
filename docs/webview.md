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

## Build and Resource Boundary

- Vite builds the React application into reproducible static assets under the Extension build output.
- The Extension constructs the complete Webview HTML document and converts every local script or stylesheet URI with `webview.asWebviewUri`.
- The Webview entry uses React's client `createRoot` API and contains no Extension activation side effects.
- Content Security Policy, nonce generation, and minimal `localResourceRoots` are owned by T0104 and are intentionally not defined by this task.
