<!--
Title format:
- Roadmap: <type>(Txxxx): <imperative summary>
- Maintenance: <type>: <imperative summary> or <type>(<scope>): <imperative summary>
- Allowed types: feat, fix, refactor, docs, test, chore, build, ci, perf
- Use an English summary, omit the final period, and keep the title within 72 characters.
-->
<!-- Summarize the outcome and why this change is needed. -->
## Summary

- <!-- First key change -->
- <!-- Why this change is needed -->

## Scope

- Work item: <!-- Txxxx or Maintenance with an issue number when available -->
- Public-contract impact: None
- Explicitly excluded:

## Review Handoff

- Task / PR / exact revision:
- Acceptance criteria / changed areas / contracts touched:
- Docs actually consulted:
- Reuse tier / candidates / conclusion:
- Known caveats or deviations: None

## Verification

<!-- List each command or manual check with its result. Report required checks that were not run. -->
- <!-- `command` — passed, or a manual check and its result -->

## Contributor checklist

- [ ] This change stays within the stated task or maintenance scope.
- [ ] I ran the checks listed under Verification and reported required checks that remain unrun.
- [ ] I removed secrets, credentials, private workspace content, and sensitive provider or MCP data
      from the diff, logs, fixtures, and screenshots.
- [ ] This change does not disclose a security report; if it does, I used the private path in
      [SECURITY.md](../SECURITY.md) instead of a public issue or pull request.

## Reuse and Similarity Audit

- Audit tier and trigger: TARGETED / FULL / ESCALATED FULL — <!-- Executor reason; Reviewer escalation reason when applicable -->
- Initial targeted search scope and existing candidates:
- Existing functions/modules actively reused or deepened:
- Final targeted search against actual symbols:
- Remaining similarities and disposition:
- Full-audit inventory and definition counts: Not required / <!-- Executor evidence -->
- Reviewer verification: Evidence check/spot-check / Independent targeted verification / Independent full audit
- Reviewer full audit repeated: No / Yes — <!-- escalation reason and material differences -->

## Notes

<!-- Record design deviations, known limitations, or follow-up work. Use "None" when empty. -->
- None
