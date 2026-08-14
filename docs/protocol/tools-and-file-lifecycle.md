
## Tool Data Contracts

- Tool names are lower `snake_case`, start with a letter, contain only lowercase ASCII letters,
  digits, and underscores, and are at most 64 characters. A published name is stable: renaming it,
  reusing it for incompatible behavior, or changing its input/result meaning requires an explicit
  public-contract and compatibility decision.
- Tool Call IDs are opaque, non-empty strings of at most 128 characters. A Tool Result copies both
  the call ID and tool name exactly so consumers can preserve complete Call/Result pairs without
  inferring correlation from array position or display text.
- Generic Tool Call input is a JSON value: string, finite number, boolean, null, array of JSON
  values, or object with JSON values. It excludes `undefined`, non-finite numbers, `bigint`, sparse
  arrays, class instances, functions, symbols, cycles, and host objects. Passing this generic Schema
  does not imply that a specific tool accepts the input.
- Tool Result is a strict union discriminated by `status`. A `success` result contains JSON output
  and `truncated`; an `error` result contains one structured error and no success output. Unknown
  properties are rejected in both variants.
- Structured tool error codes form a stable closed set: `invalid-input`, `unknown-tool`, `denied`,
  `conflict`, `failed`, and `invalid-output`. The message is non-empty, at most 1,024 characters,
  and user-safe.
  It must not contain raw exception messages, stack traces, credentials, authorization material, or
  unrestricted host or provider diagnostics.
- The complete normalized Tool Result, measured as its JSON serialization encoded as UTF-8, is at
  most 1,048,576 bytes. Output producers enforce the limit while collecting data; the shared Schema
  repeats the check as defense in depth. A result must not first build an unbounded value merely to
  discover that serialization rejects it.
- `truncated: true` means content was intentionally omitted to satisfy a hard output limit. Once
  true, later serialization, persistence, context construction, and UI mapping must preserve it.
  T0401 establishes the one-mebibyte serialized ceiling and marker; T0702 implements narrower,
  type-specific character, line, and entry truncation before context insertion.
- Cancellation is not a Tool Result status or error code. A cancelled run stops the tool through its
  `AbortSignal`, emits no later result, and is represented by the owning Agent lifecycle contract.

## File lifecycle and atomic mutation contracts (T2001)

T2001 fixes the additive Tool and plan vocabulary for the Phase 20 write surface. The existing
`propose_file_edit` name and meaning remain unchanged: it accepts one existing workspace-relative
text file and a bounded, non-overlapping edit list, prepares a `TextEditPlan`, and never writes by
itself. Changing that input to an array would make an old model call mean a different operation, so
the multi-file form has a new name. The lifecycle Tools are:

- `propose_file_create`: propose one new UTF-8 text file. The strict input is
  `{ path, content }`; the target must be absent during preparation and consumption. `content` is
  bounded by the file text limits below and is never interpreted as a path or command.
- `propose_file_delete`: propose deletion of one existing UTF-8 text file. The strict input is
  `{ path }`; the Host captures the complete bounded before-text and its revision. The model never
  supplies a URI, revision, hash, or force flag.
- `propose_file_rename`: propose moving one existing UTF-8 text file. The strict input is
  `{ sourcePath, targetPath }`; both paths are validated in the same selected workspace, the
  source must exist as text, and the target must be absent. Overwrite and cross-root rename are not
  variants of this Tool.
- `propose_workspace_edit`: propose one atomic plan over two or more existing UTF-8 text files.
  Its strict input is `{ files: [{ path, edits }] }`, where each file has the same edit shape and
  limits as `propose_file_edit`. Paths are unique, sorted by canonical workspace-relative order in
  the prepared plan, and edits within a file are sorted and non-overlapping. Create, delete, and
  rename actions are deliberately rejected in this Tool; combining those effects is a future
  contract, not an interpretation of an edit-only plan.

The named DTOs reserved by this contract are `FileMutationPlanDto` (the transient immutable plan),
`FileMutationTargetDto` (one canonical target and its before/after state), `FileMutationStateDto`
(`absent` or bounded `text`), `FileMutationDiffDto` (the temporary per-file before/after projection),
and `FileMutationOutcomeDto` (`applied` plus bounded counts). They are strict JSON objects with no
unknown properties and are owned by Protocol/Core contracts; third-party VS Code or regex types
never appear. `FileMutationPlanDto` may carry the bounded proposed content needed for a transient
create/edit Diff, but the plan, content, and Diff are never persisted or sent as a Webview authority.
`CheckpointFile` uses the same state vocabulary while storing only permitted before-content and
hashes.

`FileMutationPlanDto.operation` is the closed union `"create" | "delete" | "rename" | "edit"`;
`"edit"` covers both the existing `propose_file_edit` and the multi-target
`propose_workspace_edit`, with `targets.length === 1` or `2..128` respectively. The Tool name is
still part of plan identity, so an equivalent one-file edit prepared by the two Tools cannot reuse
an approval.

`FileMutationDiffDto` is `{ path, kind, beforeText?, afterText?, sourcePath?, targetPath?, truncated }`
with `kind: "create" | "delete" | "rename" | "edit"`, deterministic target order, and the same
text/byte ceilings. It is a Host-to-Diff-presenter value, not a Webview message. The approval
projection continues to use the existing `ApprovalRequest`; its bounded summary/digest identifies
the exact Diff without copying its text.

All four names have trusted registered risk `write`. They are preparation Tools: a successful
preparation returns an internal, strict `FileMutationPlan` for the Core/Extension approval path;
it does not return a capability, consume approval, create a Checkpoint, or change the workspace.
The plan contains only Host-derived canonical target identities, the operation kind, immutable
before/after state and revisions, normalized edits, and a deterministic presentation digest. A
model-supplied path is the only target selector; Host-owned URI, Trust, revision, hashes, risk,
approval lifetime, and Checkpoint IDs never enter Tool input.

The approval vocabulary and the public lifecycle result are deliberately separate. Internally,
the Core/Extension approval state changes from `pending` to an `approved` grant, and one atomic
consumption changes that grant to terminal `consumed`; `approved` in that state machine or in an
internal consume response does not mean that a workspace write has succeeded. Existing
`propose_file_edit` keeps its current public Tool Result and meaning, including its existing
success payload `{ outcome: "approved" }`; T2001 does not rename or reinterpret that operation.
Only the new lifecycle Tools use `FileMutationOutcomeDto` in their public success Tool Result,
with `{ outcome: "applied" }` emitted after the consumed approval, durable Checkpoint, and
successful Host-owned WorkspaceEdit. The public `denied`, `conflict`, and `failed` mappings below
are lifecycle Tool Result errors, not approval-state labels.

### Shared bounds and plan identity

- Paths use the existing forward-slash, workspace-relative rule: no leading slash, backslash,
  query, fragment, empty segment, `.`/`..` segment, or absolute URI; at most 4,096 Unicode scalar
  values and 16,384 UTF-8 bytes. The selected root and canonical URI remain Host-private.
- A mutation target is a supported UTF-8 text file with no NUL or positive binary classification.
  Before and after text are each limited to 65,536 Unicode scalar values, 2,000 logical lines, and
  262,144 UTF-8 bytes. A workspace plan contains at most 128 distinct targets and at most 1,048,576
  aggregate proposed UTF-8 bytes. Producers count incrementally and reject before retaining an
  unbounded value; the normal one-mebibyte serialized Tool Result ceiling still applies.
- `TextPosition` keeps VS Code's zero-based UTF-16 code-unit offset, while text and byte limits use
  Unicode scalars and UTF-8 bytes. Ranges are half-open, in-document, and cannot split a surrogate
  pair. Empty replacement text is valid; an edit list is non-empty and edits cannot overlap or
  share a start position.
- Plan identity is a canonical structural value, not presentation text: operation kind, ordered
  canonical target identities, source/target paths for rename, before existence, before revision or
  content hash, exact edits/content, after hash, selected workspace root identity, and owning
  Session/Run/Tool Call. Any change produces a new plan and approval.

### Diff and approval projection

The approval request carries the same immutable plan identity consumed by execution. Its bounded
presentation contains the operation kind, workspace-relative targets, risk `write`, expiration,
file counts/byte counts, and a stable `diffDigest`; it never carries unrestricted before-content,
raw URI authority, host paths, or hashes as a substitute for a recheck. `View Diff` asks the Host's
existing Diff Presenter for a temporary, read-only before/after projection:

- edit plans show one diff document pair per file, grouped in deterministic path order;
- create shows an empty before document and the complete bounded proposed text;
- delete shows the complete bounded before text and an empty after document; and
- rename shows the source/target labels and the unchanged bounded text without implying overwrite.

The Diff Presenter enforces the same per-file and aggregate limits, releases temporary documents on
close/decision/cancellation/disposal, and never persists, logs, or sends the complete Diff as a
message or model context. If a complete bounded Diff cannot be prepared, approval is not offered.
The Webview renders only this Host projection and cannot edit it or widen the operation.

### Apply, result, and failure precedence

After one explicit approval, the Host enters the one-time consumption gate and revalidates Trust,
selected-root containment, canonical identity, target existence/type, every before revision, and
the exact approval presentation. It durably commits one Checkpoint before submitting one
Host-owned atomic `WorkspaceEdit`. A preflight failure performs zero writes. `applyEdit` false, a
thrown host failure, or an inability to establish all-or-nothing semantics is `failed`, never a
partial success; the committed Checkpoint remains available for reconciliation. Cancellation
closes the operation gate before any later check and is not converted to a Tool Result.

For a new lifecycle Tool Result, the stable outcome mapping is `success` with
`{ outcome: "applied" }`, or one structured error: `denied` for an explicit rejection or terminal
approval state, `conflict` for stale/missing/replaced targets, Trust/scope/canonical identity
mismatch, target collision, or a restore precondition conflict, and `failed` for Checkpoint
persistence or Host application failure. The existing `propose_file_edit` mapping remains its
current Core/Extension contract rather than being silently changed by this additive section.
Preparation schema/boundary errors remain `invalid-input`; malformed Host projections remain
`invalid-output`. When multiple failures race, the owner reports the first failure in this order:
cancel/closed gate, invalid input, approval terminal/expiry, Trust and scope, canonical identity
and target preconditions, revision/target conflict, Checkpoint durability, then WorkspaceEdit
application. No lower-priority detail is used to disclose workspace state.

### Checkpoint and compatibility surface

One semantic mutation, including a workspace edit, owns one immutable Checkpoint. Its ordered target
records use a strict before/after state union: `before: { kind: "absent" } | { kind: "text", content,
beforeHash }` and `after: { kind: "absent" } | { kind: "text", afterHash }`. Legacy edit records
with `beforeContent`, `beforeHash`, and `afterHash` remain readable as `before.kind: "text"`; new
create/delete/rename records must not encode absence as an empty string. The Checkpoint stores no
proposed after-content, approval presentation, Diff, or secrets. A create restore deletes only when
the target still hashes to `afterHash`; a delete restore recreates only when the target is absent.
For rename, the ordered pair is exact: the source records `before: text(content, beforeHash)` and
`after: absent`, while the target records `before: absent` and `after: text(afterHash)` with
`afterHash == source.beforeHash` because rename does not change bytes. Restore first requires the
canonical source to be absent and the canonical target to contain text hashing to that `afterHash`,
then atomically renames target back to source and verifies source hashes to `beforeHash` and target
is absent. Any identity, state, or hash mismatch conflicts the whole restore without writes.

This is an additive version-1 record extension owned by the Persistence/Protocol schemas. A reader
that does not understand the state union rejects that record as unsupported/corrupt rather than
treating absence as an empty file; old records remain readable without migration. Any future change
to target identity, state meaning, or restoration semantics requires a new persisted-format decision
and compatibility fixtures. Recovery is explicit, all-target, Host-atomic, and never accepts model
replacement text or a force flag.

### Search regex mode

`search_files` keeps its current exact-substring behavior when `mode` is absent or
`mode: "literal"`. An explicit `mode: "regex"` opts into the bounded **RE2-compatible dialect**;
this is a product contract, not a requirement to expose a particular engine. The pattern is the
existing bounded `query` string (at most 256 Unicode scalar values/1,024 UTF-8 bytes), and no
engine-specific flags or replacement syntax cross the Tool boundary.

The dialect admits RE2's regular operators (literal/rune escapes, concatenation, alternation,
character classes including supported Unicode classes, non-capturing/numbered/named groups, the
standard greedy/non-greedy repetitions, and `^`, `$`, `\\A`, `\\z`, `\\b`, `\\B`) and rejects
backreferences, look-ahead/look-behind, recursion, conditionals, atomic or possessive groups,
engine-specific callouts, invalid UTF-8, and every unknown flag or escape. RE2's leftmost-first,
non-overlapping match order is the semantic reference. Empty matches are not emitted; the scanner
advances one Unicode scalar after an empty match so a pattern such as `a*` cannot loop at one
position. Columns retain the existing one-based UTF-16 search projection.

Safety is proved by the combined bounds: a pattern is compiled once; each candidate file is at
most 262,144 UTF-8 bytes/65,536 scalars, at most 1,000 files are scanned, and at most 200 matches
are retained. The controlled engine must guarantee linear-time matching in input length, expose a
bounded compiled-program/state measure, and yield at file/line chunks to the Tool's `AbortSignal`.
T2005 must enforce a per-file complexity budget of at most 16,777,216 pattern-state/input-scalar
units and an aggregate budget of at most 67,108,864 units; exceeding either rejects the regex
operation with `invalid-input` and a fixed, user-safe limit message, and produces no partial match
set. An engine that cannot enforce these bounds or cancellation is not eligible, even if its API
accepts the syntax. Normal file/result truncation retains the existing `truncated` marker.
