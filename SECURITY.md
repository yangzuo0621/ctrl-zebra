# Security Policy

CtrlZebra is a local-first desktop VS Code Extension, but configured model Providers, local MCP
Servers, approved commands, and workspace content can still handle sensitive information. Follow
this policy for suspected vulnerabilities or accidental exposure of security-sensitive data.

## Report privately

Use GitHub's private vulnerability reporting form to [report a vulnerability privately](https://github.com/yangzuo0621/ctrl-zebra/security/advisories/new).
Do not open a public issue or pull request with exploit details, credentials, private source,
prompts, workspace contents, raw logs, authorization headers, endpoint credentials, or other secret
material.

If the private form is unavailable, contact the repository maintainer through GitHub and request a
private channel without publishing the report details. Do not paste a secret into a public fallback
channel. If a credential may have been exposed, revoke or rotate it with the relevant Provider or
service before sharing sanitized evidence.

## What to include

Provide only the minimum sanitized information needed to reproduce and assess the issue:

- a short description and affected behavior;
- impact and likely attack path;
- a minimal reproduction that contains synthetic values only;
- the affected version or commit, operating system, and VS Code version; and
- any mitigation or regression information that is safe to disclose privately.

Do not attach complete conversations, workspace files, provider responses, MCP process output,
configuration files, crash dumps, or logs that have not been reviewed for secrets and personal data.

## Scope

This policy covers the CtrlZebra source repository, extension code and documentation, repository
automation, and release artifacts produced by the project. Vulnerabilities in a configured model
Provider, third-party MCP Server, VS Code, an operating system, or another dependency should also be
reported to that project's security contact; include only the sanitized boundary information needed
to explain CtrlZebra's impact.

## Supported versions

Security reports are accepted for the current default branch and for release artifacts produced from
it. The repository does not promise support for abandoned branches or modified downstream builds.

## Related rules

- The [contributor guide](CONTRIBUTING.md) defines issue, pull-request, and verification workflow.
- The [product security contract](docs/security.md) owns implementation security invariants.
- The [privacy notice](PRIVACY.md) describes local storage and external data flows.
- The [release checklist](docs/release-checklist.md) owns release-gate requirements.
