# Phase 1 Release Checklist

This checklist is the T1005 release gate for the desktop VSIX. It records repository readiness; it
does not authorize Marketplace publication, version changes, tags, or release creation.

## User documentation

- [x] The root and packaged README files are identical and describe requirements, VSIX installation,
  a complete Gemini onboarding path, local OpenAI-compatible setup, configuration, tools, approvals,
  local data, privacy, limitations, development checks, and licensing.
- [x] Every contributed `ctrlZebra.provider.*` setting is documented with its default, scope,
  accepted values, and security constraints.
- [x] Known limitations distinguish Phase 1 behavior from future candidates and identify incomplete
  remote-provider credential onboarding.
- [x] The privacy notice distinguishes local storage, provider transmission, approved-command
  behavior, non-collection, retention limitations, and third-party terms.

## Legal and package content

- [x] The project uses the MIT License with copyright `2026 Zuo Yang`.
- [x] Root and packaged LICENSE files are identical, manifests declare `MIT`, and packaging validates
  the documents before building.
- [x] The official package command does not bypass the `vsce` license check.
- [x] The VSIX allowlist includes the processed license and excludes Source Maps, tests, caches,
  credentials, local state, and `node_modules`.

## Security and operation

- [x] The README states that prompts, relevant context, and tool results can be sent to the selected
  model provider.
- [x] Credential entry uses VS Code SecretStorage, and documentation warns against placing keys in
  chat, settings, workspace files, logs, or commands.
- [x] Read tools remain workspace-scoped; file writes and commands require workspace trust and an
  exact fresh approval.
- [x] Session recovery never resumes model, approval, or tool side effects, and Checkpoint restore is
  documented as conflict-safe rather than a merge operation.

## Final verification

- [ ] `pnpm install --frozen-lockfile`, `pnpm check`, `pnpm typecheck`, `pnpm test:unit`,
  `pnpm test:integration`, and `pnpm build` pass.
- [ ] `pnpm package:vsix` produces a clean, upstream-traceable artifact whose independent inspection
  confirms the allowlist, license, commit, and size limits.
- [ ] `pnpm smoke:vsix -- <artifact>` installs that exact VSIX in isolated user-data and extensions
  directories, activates CtrlZebra, opens the Agent view, and observes the expected structured log.
- [ ] `git diff --check`, final diff review, and `git status --short` show only the intended T1005
  source changes before commit and a clean worktree before official packaging.

The verification items are checked only after the commands execute successfully on the release
candidate commit. A checked repository gate is not evidence that the VSIX was published.
