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

## API Key Secret Storage

- The OpenAI API key is stored under the stable, Extension-owned name
  `ctrlZebra.provider.openai.apiKey`. Secret names are implementation contracts and must not be
  derived from Webview input, workspace content, model output, or the secret value itself.
- Saving stores the supplied value exactly and replaces any value already held under that name.
  Reading returns `undefined` when no value exists. Deleting is idempotent, including when the
  value is already absent.
- The Extension Host is the only owner of SecretStorage access. API keys must not enter Webview
  state, protocol messages, workspace or global state, persisted sessions, fixtures, snapshots,
  command arguments, environment variables, or model-visible content.
- The adapter does not cache API keys. A retrieved string remains in memory only for the lifetime
  of the operation that needs it; callers must not retain it in long-lived services, module state,
  closures, or diagnostic objects.
- Logs and telemetry must never contain an API key, a key prefix or suffix, authorization headers,
  SecretStorage values, or third-party errors that could embed them. Secret names may be used only
  when required for internal diagnosis and must not be presented as credential values.
- Read, save, and delete failures are reported as operation-specific, user-safe errors. User-facing
  text may explain that the saved API key could not be accessed or changed and suggest retrying, but
  must not include the submitted value, the stored value, or the original error message.
- Automated tests use conspicuously fake values such as `test-openai-api-key`, operate only on an
  in-memory fake, and never read or mutate a developer's real SecretStorage. A manual Extension Host
  smoke test must also use a fake value and delete it before the test ends.
