# Security Guidelines

This document defines the Webview security constraints established before T0104. It complements the trust boundaries in `AGENTS.md` and applies to every HTML document produced by the desktop Extension.

## Content Security Policy

- Every Webview document starts from `default-src 'none'` and opens only the resource types required by the current UI.
- Styles may load only from the current Webview resource origin exposed by `webview.cspSource`.
- Scripts require a fresh, cryptographically random nonce for each generated document. The same nonce appears in the `script-src` directive and on the intended script element.
- `unsafe-inline`, `unsafe-eval`, wildcard sources, unrestricted `https:` sources, remote frames, and network connections are forbidden by default.
- A new resource type or origin requires a concrete current-task use case, the narrowest possible CSP directive, and tests that prove unrelated sources remain denied.

## Nonce Ownership

- The Extension Host generates at least 128 bits of randomness for every HTML document and never reuses a nonce intentionally.
- Nonces are document-local implementation details. They are not persisted, sent through the Webview message protocol, logged, or exposed to Webview application state.
- Dynamic or untrusted content never receives a nonce. A nonce authorizes only static script elements emitted by the Extension-owned HTML builder.

## Local Resource Boundary

- `localResourceRoots` is set explicitly and contains only the Extension directory that holds the built Webview assets required by the page.
- Workspace folders, the complete Extension installation directory, user directories, and temporary directories are not Webview resource roots.
- Every local script, stylesheet, image, or font URI is built from an Extension-owned `vscode.Uri` and converted with `webview.asWebviewUri`.
- URI strings from Webview messages, model output, persisted content, or workspace files are never passed directly to `asWebviewUri`.

## Remote Resources

- Remote scripts, stylesheets, images, fonts, frames, media, and connections are denied unless a later approved task documents an explicit requirement.
- When remote access is introduced, allowlists use exact schemes and origins. Wildcards, redirects to unlisted origins, and user-controlled origins remain forbidden.
- Secrets, authorization headers, workspace content, and identifiers must not be sent to remote origins from the Webview.

## Untrusted Content

- Treat Webview messages, model output, workspace text, persisted values, and URL-derived values as untrusted.
- Render untrusted text through DOM text APIs or React text interpolation. Do not inject it with `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, or equivalent sinks.
- If a future feature must render formatted untrusted markup, it requires a narrowly configured, maintained sanitizer and tests for script elements, event-handler attributes, dangerous URLs, SVG, MathML, and mutation-based bypasses.
- HTML attributes and CSP metadata assembled by the Extension are escaped before interpolation. Validation and sanitization complement CSP; CSP is not their replacement.
