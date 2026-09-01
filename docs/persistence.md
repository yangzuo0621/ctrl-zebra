# Persistence Contract

This document is the canonical owner for durable layout, records, cleanup, recovery, compatibility,
and persistence fixtures. Persistence adapters must treat every value read from storage as untrusted
and validate it before constructing Core values. Setting names, scopes, bounds, and defaults remain
owned by the [configuration contract](configuration.md); security and UI projection rules stay in
[Security](security.md) and [Webview](webview.md).

## Storage layout and format version

The Extension owns the storage root. Protocol and Core code deal only in portable relative path
segments and never access a filesystem directly.

```text
<storage-root>/
├── sessions/
│   └── v1/
│       └── <encoded-session-id>/
│           ├── manifest.json
│           ├── messages.jsonl
│           └── events.jsonl
└── checkpoints/
    └── v1/
        └── <encoded-checkpoint-id>.json
```

- The current persistence format version is the positive integer `1`; its directory component is
  `v1` and its manifest value is also `1`.
- A session ID is encoded as lowercase hexadecimal UTF-8 bytes before it becomes a directory name.
  The encoded value is one portable path segment and cannot contain separators, dot segments,
  drive prefixes, URI syntax, or platform-specific reserved characters. Persisted session IDs must
  be well-formed Unicode and no more than 100 UTF-8 bytes, which bounds the encoded segment to 200
  characters for portable filesystems.
- Path helpers return relative path segments. A host adapter joins those segments to its trusted
  storage URI; callers must not interpret them as absolute filesystem paths.
- File names and directory components are public persisted-format constants. Changing their meaning
  requires a new format version.
- A Checkpoint ID uses the same lowercase hexadecimal UTF-8 encoding and 100-byte portable input
  limit as a persisted Session ID. The `.json` suffix is part of the Checkpoint file name, not the
  encoded identifier.

## Session deletion and local-history clearing (T2104)

Deletion is an explicit Host-owned data-control operation. Core supplies only validated opaque
identities and portable relative path segments; it never joins a user-provided value to a filesystem
path. The Extension validates the exact Session ID, encodes it with `getSessionPersistencePaths`,
and removes that Session directory recursively. The operation covers `manifest.json`,
`messages.jsonl`, `events.jsonl`, atomic-write siblings such as `manifest.json.tmp` and
`events.jsonl.append.tmp`, and any other temporary file owned by that Session directory. A missing
Session directory is an idempotent no-op; an invalid ID is rejected before a storage call.

Checkpoints are independent files, so deleting one Session scans the bounded `checkpoints/v1`
directory and removes only validated or safely attributable records whose `sessionId` is exactly the
requested Session, together with the matching atomic-write temporary file. A malformed or
unattributable Checkpoint is not guessed to belong to a Session: it remains and the operation reports
a partial failure that can be retried. The scan is bounded by the existing Checkpoint file ceiling.

Clear-all local history is also explicit and idempotent. It removes every Session directory and every
committed or temporary Checkpoint file under the versioned persistence directories, including damaged
records that cannot be restored. It never removes workspace files, user code, or unrelated VS Code
storage. Session deletion and clear-all do not change the persisted format version or rewrite any
remaining record. Each cleanup category returns bounded successful/failed entry counts; a later
failure remains a partial result rather than losing the entries already removed.

Before either operation starts, the Host closes the owning Run event gate and deterministically
cancels and settles an active Run. Storage cleanup then runs to completion for every category it can
attempt. A storage error is never reported as full success: the result identifies a partial cleanup
and leaves the operation safe to retry. Recovery/list readers must not expose a Session after its
directory has been removed, and a stale restore result must not recreate its Webview projection.

## Automatic Session retention (T2105)

Automatic local retention uses the machine-scoped `ctrlZebra.sessionRetention.enabled` and
`ctrlZebra.sessionRetention.days` settings defined by the [configuration contract](configuration.md#session-retention-settings-t2105).
The [Session retention lifecycle](architecture/context-and-session.md#session-retention-lifecycle-t2105)
owns calculation, explicit list/refresh triggering, protected states, locking, cancellation, and the
cleanup result. This section owns the persistence facets: the manifest's existing `updatedAt` is
compared with the injected clock cutoff using `<=`; no new timestamp or persisted field is introduced.
Session metadata updates and committed events already advance `updatedAt`. Candidate collection reads
at most 10,000 bounded manifest records and does not load event logs.

An expired Session is removed through the existing exact encoded Session-directory deletion, then its
owned Checkpoints are removed by one bounded scan of `checkpoints/v1`. Only a validated Checkpoint whose
`sessionId` exactly matches a successfully removed Session is attributable; committed and matching
atomic-write temporary files are included. Invalid, unreadable, or unattributable records remain in
place and contribute to a bounded failure report. Cleanup is local-only and never removes workspace
files, user code, Provider secrets, or another Extension's storage.

The cleanup report retains bounded `scanned`, `expired`, `protected`, `removed`, and `failed` entry
counts for Host feedback. A storage failure does not turn earlier removals into a false all-success
result; remaining data is safe to retry on the next explicit history refresh. The v1 persisted format
and Session summary wire projection remain unchanged.

## Complete local-data clearing (T2106)

Complete clearing is an explicit Host-owned data-control operation for uninstall or device handoff;
it does not introduce a persisted-format migration. This section owns the Session, Checkpoint, and
Extension-owned storage cleanup portions. The exact configuration leaves are defined by the
[configuration contract](configuration.md#complete-local-data-clearing-t2106); operation locks,
confirmation, SecretStorage, process, and redaction boundaries are defined by
[Security](security.md#complete-local-data-clearing-t2106). The operation is single-flight and a
later request retries the remaining data after a partial result.

Session and Checkpoint stores retain ownership of their versioned directories. The Extension's
workspace `storageUri` root cleanup removes only direct entries outside `sessions` and `checkpoints`,
and the Extension-owned `globalStorageUri` root is scanned separately for CtrlZebra temporary/cache
artifacts. Missing roots are empty and safe to retry. The latter is Extension-scoped storage; VS Code
global data outside CtrlZebra, workspace files, user code, and another Extension's storage are never
targets. Mementos are cleared only through the current Extension's `globalState` and `workspaceState`.

Before any durable storage cleanup, the Host has applied the cancellation and invalidation gates from
[Security](security.md#complete-local-data-clearing-t2106). Each storage category returns bounded
deleted/failed counts; one category failure does not suppress later storage categories, and no partial
result is reported as complete. A restart does not resume work or recreate deleted state: remaining
data is discoverable on the next explicit clear request and can be safely retried. This operation is
the uninstall-before path, not automatic cleanup or workspace deletion.

## File responsibilities

### `manifest.json`

The manifest is one UTF-8 JSON object with no byte-order mark. It contains the format version,
session identity and status, creation and update timestamps, and the last committed event sequence.
Unknown fields are rejected. `lastEventSequence` is `0` before any event is committed and otherwise
matches the greatest committed sequence in `events.jsonl`.

The manifest is metadata and an index, not a source for message or event payloads. A session is not
visible to repository readers until a valid manifest is present.

### `messages.jsonl`

Each non-empty line is one complete UTF-8 JSON object conforming to the persisted Chat Message
schema. Lines preserve append order. Writers terminate every committed record with LF and must not
pretty-print or split one record across lines.

### `events.jsonl`

Each non-empty line is one complete UTF-8 JSON object with a positive, monotonically increasing
`sequence`, an RFC 3339 timestamp in `recordedAt`, and a typed JSON event payload. Sequence numbers
are contiguous within a session and start at `1`. Lines preserve append order, end with LF, and are
never rewritten in place.

The event payload is a strict object containing a stable dotted event `type` and JSON-serializable
`data`. T0601 defines the storage envelope only; later tasks define which domain event types are
written and how they rebuild repository state.

## Multi-turn Session and Run projection

- One persisted Session is an append-only ordered transcript containing multiple sequential Runs.
  A Run is one user submission, one model/Tool loop, and one terminal outcome. The Host/Core creates
  a fresh opaque Run identity for every Run; it is distinct from the Session ID, message ID, and
  Webview `requestId`. This constraint is additive to the version `1` event envelope and does not
  authorize a format-version bump by itself.
- The ordered `events.jsonl` log is the source for model-history reconstruction. `messages.jsonl` is
  a bounded display/compatibility projection and is never trusted as an authorization source or as a
  replacement for validated event order. History construction reads only the valid prefix and never
  executes, retries, replays, or approves anything found in persistence.
- The Host projects, in sequence order, every validated user message; assistant text only when the
  owning Run reached normal `completed`; and complete assistant Tool Call plus matching Tool Result
  pairs. Reasoning, status, approval, usage, summary, MCP attachment metadata, Webview-only source
  fields, and the T1901 IDE read-only Tool projections are excluded from model history. A retained
  ordinary Tool pair is one indivisible unit.
- A `truncated`, `cancelled`, `budget-exceeded`, `failed`, or recovery-`interrupted` Run keeps its user message. Partial or empty
  assistant text is not injected. A complete Tool pair committed before the terminal outcome may be
  retained; an open call, orphan Result, duplicate call ID, or mismatched call/name pair is dropped
  only when it is the expected unfinished tail and otherwise makes the Session corrupt. No synthetic
  Tool Result, assistant end, or recovery event is written.
- The newest user message is appended by the next Run after the prior projection has passed Schema,
  identity, pair, and bound checks. Context pruning may remove old units later, but it never rewrites
  persisted history or removes the newest user message to conceal an overflow.

### Regeneration projection (T2101)

- A regeneration appends a fresh `session.user-message` with a new message ID and a strict additive
  `session.regeneration` relation `{ targetMessageId, replacementUserMessageId }`. The relation stores
  only bounded identifiers; it never stores replacement text, Tool input/output, Provider data, or an
  approval token. Existing source events remain immutable and the version `1` layout is unchanged.
- Before the replacement Run starts, the Host validates that `targetMessageId` is the latest completed
  assistant projection in the selected Session. The new model input contains the target user prompt
  and the validated history prefix before that Run. The target Run's assistant text, Tool Call/Result,
  attachments, Provider request, and approval are never replayed.
- Recovery and later history projection apply a completed relation as a replacement: the old assistant
  text and its Tool pairs remain in the source log but are omitted from the projected history/display.
  The replacement user event is source-only and is not shown as a duplicate prompt. Until the
  replacement reaches normal `completed`, the old answer stays visible and remains the projected
  answer; cancellation, budget exhaustion, failure, truncation, a damaged tail, or an incomplete relation preserves it
  and omits partial replacement output. A malformed or orphaned relation makes the Session corrupt
  rather than guessed.

### Historical edit projection (T2102)

- An edit appends a fresh `session.user-message` with the replacement content and a strict additive
  `session.edit` relation `{ targetMessageId, replacementUserMessageId }`. The relation contains
  identifiers only; it never stores the edited content, Tool data, Provider request, or approval.
  Existing user, assistant, Tool, and status events remain immutable in the version `1` log.
- Before allocating the new Run, the Host validates that the target is an exact selected user
  projection with a completed text-bearing Run. The model input is the validated history prefix
  before that target plus the new edited user content. The target's old Run and all later old-branch
  messages, Tool pairs, attachments, Provider requests, and approvals are excluded; no old Tool is
  executed as part of editing.
- Recovery and later history projection apply a completed relation as a branch projection: the
  target user content is overlaid by the replacement, the replacement Run is retained, and the old
  target output and suffix are hidden while remaining durable in the source log. The stable
  original target identity permits ordered successive edits; the latest completed relation wins,
  while an incomplete, cancelled, failed, or truncated latest replacement falls back to the prior
  completed projection. Duplicate replacement users, orphaned, out-of-order, cross-Session,
  non-completed-target, or malformed relations make the Session corrupt rather than guessed.

## IDE context and read-only Tool persistence (T1901)

IDE observations are ephemeral by default and do not change the version `1` directory layout,
manifest, JSONL envelope, or existing event meanings:

- Pending or unsubmitted editor/selection attachments, active-editor identity, selected range,
  document version, stale/truncation state, diagnostics, language-service results, provider objects,
  and Host URI identity are never written to `manifest.json`, `messages.jsonl`, `events.jsonl`,
  Webview restoration, logs, fixtures, or a new memory store. Closing the attachment, switching the
  editor/Session, cancellation, Trust loss, or disposal discards it without a persistence side effect.
- The reserved IDE read-only Tool Calls and Results are transient context projections, not durable
  model-history Tool pairs. A completed Run may retain only the normal user message and existing
  persisted events; IDE result text, source metadata, and provider output are not replayed on Session
  recovery. This prevents a later Run from silently inheriting an editor snapshot that may no longer
  exist or may have changed.
- If the user explicitly copies or sends bounded IDE text as ordinary user content, that resulting
  user message follows the existing Session persistence, deletion, and retention rules. The source
  URI, document version, stale marker, and UI attachment metadata remain excluded unless a future
  task defines a separately reviewed persisted projection.
- No migration, retention timer, pruning rule, or format-version bump is introduced by T1901. A
  future task that wants durable IDE provenance must add a strict version-compatible event, explicit
  deletion behavior, privacy review, and fixtures before implementation.

### Workspace file references (T2103)

`@` workspace file references follow the same ephemeral rule. Pending cards, search results, opaque
reference IDs, canonical URI identity, file fingerprints, document versions, stale decisions, and
unsubmitted text are never written to Session files or Webview restoration. New chat, Session switch/
restore, workspace boundary changes, cancellation, and disposal discard them without an event. At
submit, accepted file text is projected as ordinary user context for that Run; only the resulting
ordinary user message and existing Run events follow the current persistence contract. Recovery never
re-reads, reconstructs, or silently reattaches a historical file reference, and no persistence format
or migration is added by T2103.

### Corruption, tail damage, and compatibility

- A duplicate or skipped event sequence, invalid recognized payload, cross-Session identity mismatch,
  orphan or mismatched Tool Result, duplicate Tool Call ID, or an invalid lifecycle before the final
  non-empty record marks the Session corrupt and blocks continuation. Readers never guess, reorder,
  silently repair, or fall back to a new Session.
- A truncated or invalid final non-empty JSONL record remains tail damage under the existing rule:
  readers retain the preceding valid records, surface the damaged-tail marker, and never resume the
  interrupted operation. Any open Tool or reasoning block in that prefix is projected as partial or
  omitted according to its bounded recovery contract.
- Existing format `v1` Sessions written before Run identity support, including legacy single-turn
  Sessions, remain readable without in-place migration. A reader treats recognized legacy events that
  lack Run identity as one deterministic legacy Run and applies the same ordered projection rules.
  A recognized pre-multiturn Session is identified by at least one persisted user message and no
  `session.status-changed` event. It opens as a read-only historical projection: its source files,
  manifest metadata, and event sequence remain unchanged, and no continuation, regeneration, or edit
  may append events or update status. The restored projection carries the bounded `readOnly` marker
  so the Webview can preserve history while directing the user to `New chat`.
  Unsupported, missing, or mismatched format versions remain isolated as unsupported/corrupt; they are
  never guessed as the current format. New persistence fields or strict event payloads require an
  explicit compatibility fixture and owning task.
- Recovery normalizes active statuses to `interrupted`, preserves `completed`, `truncated`, `cancelled`, `budget-exceeded`, `failed`,
  and existing `interrupted`, and performs no model, Tool, approval, or Provider action. An explicit
  later submit may reset a recovered writable Session to a new Run; a read-only legacy Session remains
  historical and cannot be continued. Recovery itself never resumes work.

### Session resource ceilings

Storage adapters enforce all bounds before constructing unbounded values. The current version `1`
ceilings are one event record ≤1,048,576 UTF-8 bytes, one event log ≤16,777,216 bytes, at most
10,000 event records, at most 10,000 restored messages, Session ID ≤128 characters (persisted ID
≤100 UTF-8 bytes), submitted/chat content ≤1,000,000 characters, and the Core model context window
≤2,000,000 estimated tokens. Existing Tool Call/Result and reasoning ceilings remain in force. A
limit violation is a stable bounded failure or corruption result; it is never hidden by an unbounded
allocation or silent cross-Session fallback.

#### Reasoning summary events

Persistence stores only the bounded, user-visible reasoning projection accepted by the Extension
collector, never raw Provider events. The projection uses these additive version `1` event types:

- `session.reasoning-start` with strict data `{ blockId }`;
- `session.reasoning-delta` with strict data `{ blockId, text }`;
- `session.reasoning-end` with strict data `{ blockId, truncated }`;
- `session.reasoning-limit` with the same strict block- or run-scoped data defined for
  `extension/reasoning-limit` in [Protocol](protocol.md).

The block ID and text limits, maximum 32 blocks, 32,768-code-point/131,072-byte block ceilings, and
65,536-code-point/262,144-byte run ceilings are part of the persisted event meaning. Collection
applies those limits before constructing or appending records; each delta record is independently
bounded to 8,192 code points and 32,768 UTF-8 bytes. Provider metadata, SDK IDs, raw responses,
opaque or encrypted reasoning, and discarded overflow text are not persisted.

These events retain their sequence among `agent.text-delta`, Tool, approval, usage, and status
events. A start opens one block, deltas append only to that open block, and an end closes it. Empty
blocks may remain in the event log to preserve source order but are omitted from the recovered
display projection. A recognized reasoning event with invalid data, a duplicate or nested start, a
delta or end without the matching open block, a duplicate end, a limit marker inconsistent with
the collected bounds, or cumulative content beyond the limits makes the current-version session
corrupt; recovery does not guess, reorder, or silently repair it.

An open block at a terminal status, a final tail-damaged record, or a session normalized to
`interrupted` is recoverable as a partial block. Recovery retains the bounded text already committed,
sets its display state to `partial`, and does not append a synthetic end. A valid end produces
`complete`; its `truncated` value and any limit marker survive recovery. The recovered
`startSequence` and optional `endSequence` are the original event sequence values, so reasoning
remains distinguishable and orderable relative to answer and Tool events.

The existing `messages.jsonl` Chat Message schema is unchanged. Reasoning is not an assistant
message, final answer, Tool message, context summary, or model-history item and is never copied into
those records.

#### Provider token usage events

The Extension persists the bounded Provider Usage projection as the additive version `1` event
`session.usage` with strict data `{ inputTokens?, outputTokens?, totalTokens? }`. Each present value
is an actual non-negative Provider count no greater than `2,000,000`. An empty Provider report is
consumed as no usable count and is not persisted; missing fields remain unknown. Prices, billing
data, estimates, SDK metadata, and raw responses are never persisted.

Usage events retain their source order with text, reasoning, Tool, and status events, but remain
outside model history. Recovery validates every recognized Usage payload and sums each field
independently across the ordered Session records. A field absent from every record remains unknown;
partial input/output/total values are not inferred from one another. A cumulative overflow or
malformed recognized payload marks the Session corrupt rather than truncating or guessing. The
recovered projection is sent with `extension/session-restored`; live `extension/token-usage`
events are used only while the matching Run is preparing or streaming, and late or duplicate events
do not mutate recovered state.

#### Run token budget events

The Extension persists each warning or exceeded budget transition as the additive version `1` event
`session.run-budget`. Its strict data is the bounded Run token budget snapshot: estimates and actual
Provider Usage remain separate fields, and no price, billing, SDK metadata, or raw response is
stored. The shared Protocol schema requires `effectiveTokens` to equal the greatest observed count;
warning snapshots must reach `warningTokens`, and exceeded snapshots must reach `maxTokens`.

Recovery accepts at most one warning followed by one exceeded snapshot within each status-delimited
Run. A malformed, non-monotonic, duplicate warning, or event after exceeded in the same Run marks the
Session corrupt. The latest valid snapshot across Runs is returned as `restoredSession.runBudget`, and a recovered
`budget-exceeded` status is displayed as a terminal, user-recoverable Run outcome. Budget events
remain outside model history and never resume a Provider request or Tool operation.
The cancellation-priority race is the one exception to exceeded-terminal fencing: an exceeded event
immediately followed by `cancelled` remains a cancelled Run with a display-only snapshot. Exceeded
followed by `completed`, `truncated`, `failed`, or `interrupted`, including a manifest that claims
one of those outcomes, is corrupt rather than restored as completed with an exceeded budget.

## Compatibility and migration

- Readers select a decoder from the version directory and then require the manifest version to
  match. A missing, unsupported, or mismatched version is isolated as a damaged or unsupported
  session; it is never guessed or silently interpreted as the current format.
- Current-version readers reject unknown manifest and record fields so format changes cannot be
  accepted accidentally.
- Backward-compatible behavior changes still require regression fixtures. A structural or semantic
  incompatibility requires a new version directory and an explicit migration that reads the old
  format and writes a complete new-format session.
- Migration must not modify the source session in place. The new session becomes visible only after
  all data files and its manifest have been committed successfully. T2203 uses the read-only fallback
  for the recognized pre-multiturn v1 difference because its exact lifecycle boundary cannot be
  inferred safely; it creates no destination Session and therefore cannot expose a partial migrated
  Session. No automatic migration or source rewrite is performed.
- The read-only fallback is a bounded read/validation path. Cancellation, a read or projection failure,
  and an unavailable store leave the source untouched; the fallback performs no rollback write because
  it has no destination. Explicit Session deletion and clear-all remain the only allowed mutations of
  that historical source.
- Reasoning events do not change the version `1` directory layout, manifest, JSONL envelope, Chat
  Message schema, or meaning of an existing event. The event envelope intentionally admits later
  dotted event types, so this is an additive version `1` extension rather than a structural or
  semantic incompatibility. It does not require a `v2` directory or migration.
- A version `1` session written before reasoning support contains none of these events and restores
  with no reasoning blocks or placeholder. A legacy reader may ignore the new event types and still
  recover its previously understood answer history. A current reader validates every recognized
  reasoning event strictly; it never treats an unknown event as reasoning.

## Damage handling and writes

- `manifest.json` is replaced atomically: write a sibling temporary file, flush and close it, then
  rename it over the destination. Temporary files are never valid manifests and may be removed only
  by the owning storage adapter.
- JSONL records are appended as complete bounded lines. Readers ignore blank lines.
- A final non-empty JSONL line that is truncated or invalid is treated as tail damage: readers retain
  all preceding valid records and report the damaged tail. An invalid record before the final
  non-empty line, a duplicate or skipped event sequence, or a record that fails its schema makes that
  file corrupt; readers must not skip over it and continue.
- Storage adapters enforce existing size and collection limits before parsing into unbounded memory.
  Exact operational limits belong to the store tasks that perform I/O.
- A damaged session is isolated from other sessions. Recovery must not make it visible as healthy or
  execute persisted approvals, tools, or other side effects.

## Interrupted recovery

- `interrupted` is a persisted recovery-only Session status. Automatic recovery and the live Agent
  Runtime never transition into it or resume work from it. After recovery, an explicit user submission
  may invoke the Core-owned `beginRun` reset gate to move that recovered Session from `interrupted` to
  `preparing` for a fresh Run with new cancellation and resource ownership; no other live transition
  out of `interrupted` is legal.
- On recovery, `idle`, `preparing`, `streaming`, `awaiting_approval`, and `executing_tool` are written
  back as `interrupted`. `completed`, `truncated`, `cancelled`, `budget-exceeded`, `failed`, and
  `interrupted` remain unchanged.
- Recovery may read history and update the manifest status only for a writable Session. For a recognized
  read-only legacy Session it projects `interrupted` when the source status is active but does not write
  that recovery-only status back. It never resumes a model request, consumes an approval, executes a
  tool, or repeats any other persisted side effect.
- Recovery may project committed reasoning events for display, including bounded partial blocks and
  truncation state. It never resumes a reasoning stream, calls a Provider, completes an open block,
  regenerates omitted text, inserts reasoning into model context, or emits live reasoning deltas.

## Checkpoint durability and recovery

A Checkpoint is one immutable record for one Agent file-mutation operation. It has a host-generated
Checkpoint ID, the owning Session and Run IDs, a creation timestamp, and a non-empty ordered set of
distinct canonical file targets. Each target records the exact UTF-8 text that existed before the
operation together with lowercase SHA-256 `beforeHash` and `afterHash` values. The `afterHash` is
computed from the exact text proposed for the write, even though the proposed text is not duplicated
in the Checkpoint. IDs, timestamps, targets, content, hashes, and field names are persisted data; a
change to their meaning requires an explicit format migration.

Checkpoint creation means the complete record has passed schema and integrity validation and has
been durably committed by the host-owned persistence adapter. The complete multi-file Checkpoint
must be committed before the first corresponding workspace write begins. A memory-only record,
partially written record, pending flush, or failed rename is not a created Checkpoint and must block
the entire mutation. T0802 defines the concrete storage layout and commit mechanism; it must not
weaken this ordering.

T0802 stores each Checkpoint as one strict UTF-8 JSON object followed by LF at
`checkpoints/v1/<encoded-checkpoint-id>.json`. A record is limited to 4,194,304 UTF-8 bytes. Creation
writes a sibling `.tmp` file and atomically renames it without overwrite; an existing destination,
invalid model, before-content Hash mismatch, size violation, temporary write failure, or commit
failure rejects creation. A failed creation cleans its temporary file when possible and never
authorizes the bound workspace write. The host retains a successfully committed Checkpoint even if
the later workspace operation fails, so it never falsely claims the pre-write recovery record was
absent.

One Checkpoint is the atomic recovery boundary for a multi-file operation:

- The writer does not split one semantic multi-file mutation into independently recoverable
  Checkpoints. It creates one complete Checkpoint, then submits the workspace changes as one
  host-atomic operation. A failed or partially applied host operation is not marked as successfully
  applied and must be surfaced for reconciliation rather than guessed from persisted state.
- Automatic recovery first reads every target and verifies that its current lowercase SHA-256 hash
  equals that target's `afterHash`. Missing, unreadable, non-text, non-canonical, out-of-scope, or
  mismatched targets make the whole Checkpoint conflicted. A conflict changes no file and is shown
  to the user; recovery never overwrites or silently merges later user changes.
- Only after every target passes the preflight may recovery restore all recorded before-content in
  one host-atomic workspace operation. Immediately before applying it, the host revalidates scope,
  canonical identity, and current hashes so a path or content race cannot bypass the preflight.
- After restoration, each target must hash to its recorded `beforeHash`. A failed verification is a
  recovery failure and must not be reported as success.

### File lifecycle Checkpoint extension (T2001)

T2001 reserves one additive lifecycle record for each semantic mutation. The existing
`propose_file_edit` Checkpoint shape remains valid for legacy one-file edits. New lifecycle records
use a strict target state union so an absent file cannot be confused with an existing empty file:

```text
before: { kind: "absent" }
      | { kind: "text", content, beforeHash }
after:  { kind: "absent" }
      | { kind: "text", afterHash }
```

The top-level record continues to bind one Host-generated `id`, exact `sessionId` and `runId`, a
creation timestamp, and a non-empty ordered target set (at most 128). An edit target has text before
and after hashes; a create target has `before.kind: "absent"`; a delete target has
`after.kind: "absent"`. A rename is exactly two ordered target records: the source has
`before: { kind: "text", content, beforeHash }` and `after: { kind: "absent" }`; the target has
`before: { kind: "absent" }` and `after: { kind: "text", afterHash }`, where `afterHash` equals
the source `beforeHash` because the bytes are moved unchanged. Proposed after-content, Diff text,
approval presentation, raw host URI objects, and secrets are never persisted. Before-content
remains bounded to 65,536 Unicode scalars, 2,000 logical lines, and 262,144 UTF-8 bytes per text
target, with the existing 4,194,304-byte record ceiling and 128-target limit.

Creation is durable-before-side-effect: the complete record is schema/integrity checked, written to
the temporary Checkpoint path, flushed/closed and atomically renamed before the first WorkspaceEdit
submission. A duplicate ID, state/hash mismatch, absent-vs-empty ambiguity, target overflow,
temporary write failure, or rename failure authorizes no workspace mutation. The Checkpoint remains
after an apply failure so the Host can reconcile rather than claiming that no recovery record exists.

Recovery is an explicit all-target operation. A create target may be removed only when its canonical
identity is unchanged and current text hashes to `afterHash`; a delete target may be recreated only
when it is absent. A rename may be reversed only when the canonical source is absent, the canonical
target contains text hashing to its recorded `afterHash` (equal to the source `beforeHash`), and the
ordered source/target identities match exactly; the Host then atomically renames target to source
and verifies source `beforeHash` plus target absence. A multi-file edit restores all targets through
one WorkspaceEdit only after every target passes its after-state check. The Host repeats scope,
canonical identity and hash checks immediately before submission. Any mismatch, missing/unreadable/
binary target, or failed verification is one bounded conflict and leaves every target unchanged.
Recovery never accepts replacement text, extra targets, merge instructions, or a force flag from
model/Webview input.

The extension of the v1 checkpoint record is additive for the current reader: records written before
T2001 remain readable as `before.kind: "text"`. A reader that cannot validate the state union must
reject a lifecycle record as unsupported/corrupt, never default `absent` to `""`; no in-place
migration or automatic rewrite is performed. Any future change to state meaning, target identity,
restore semantics, or record limits requires a new persisted-format decision and versioned fixtures.

Checkpoints are local recovery data and may contain workspace source text. They follow the existing
secret exclusion rules and must not enter model context, Webview state, logs, telemetry, or approval
presentation. T2105's retention policy is the only automatic Session/Checkpoint cleanup path: it is
disabled by the machine setting, bounded, ownership-checked, and never applies to workspace files.

## Secret exclusion

Persistence contains conversation and operational history, never credentials. API keys,
authorization headers, SecretStorage values or keys, environment secrets, raw third-party errors,
and credential-bearing request metadata are forbidden in manifests, messages, events, temporary
files, logs, fixtures, and snapshots. Stable safe error categories may be persisted when their schema
allows it. Host adapters must redact before constructing persisted records; encryption is not a
substitute for excluding secrets.

Reasoning text is persisted conversation content and therefore remains untrusted and potentially
sensitive. Only the bounded user-visible text is allowed; Provider metadata, signatures, encrypted
reasoning, authorization material, raw request/response data, and hidden model state remain
forbidden. Encryption does not make an otherwise forbidden reasoning payload acceptable.

## Test fixtures

- Fixtures live under a directory named for the format, such as `fixtures/persistence/v1/`.
- Every fixture includes a valid manifest whose version matches its directory. Tests state whether a
  fixture is valid, unsupported, tail-damaged, or corrupt; malformed fixtures are not reused as
  normal examples.
- Current-format fixtures are immutable compatibility evidence. A format change adds a new versioned
  fixture set instead of rewriting old fixtures.
- Fixtures use deterministic IDs, timestamps, sequences, LF endings, and obviously fake content.
  They must never contain user data or real secrets.
- Reasoning fixtures are added beside, rather than substituted for, the existing version `1`
  fixtures. They include normal complete blocks, multiple/interleaved blocks, a bounded truncated
  block, an interrupted partial block, a pre-reasoning session, tail damage, and a malformed
  reasoning lifecycle.

## MCP persistence projection

The projection below covers the stage 14 MCP surface and the T1804 dual-era contract. MCP
persistence records bounded provenance and conversation-visible outcomes, never a live Client,
connection capability, probe/fallback state, or replayable authorization. The user-scoped Server
configuration remains in VS Code configuration and is not copied into Session storage.

### Additive version `1` events

The existing extensible event envelope admits the following strict additive event types without
changing the `v1` directory layout, manifest, Chat Message schema, or existing event meanings:

- `session.mcp-tool-call` contains the existing bounded Tool Call identity and validated JSON input
  plus strict source `{ serverId, registryName, mcpToolName, generation }` and, for new records,
  `provenance`.
- `session.mcp-tool-result` contains the existing normalized Tool Result plus the same source
  identity. It stores only supported bounded text/structured content and the existing truncation
  marker and the same optional `provenance`, never an SDK result, JSON-RPC error, raw Server error
  data, or unsupported content.
- `session.mcp-resource-attached` contains `{ snapshotId, serverId, uri, mimeType, text,
  truncated, provenance? }` for the exact bounded immutable snapshot inserted into the Run context.
- `session.mcp-prompt-confirmed` contains `{ serverId, promptName, projectedText }`, where
  `projectedText` is the exact bounded ordinary user attachment—including the reviewed argument and
  source-role provenance labels—sent to the current input flow. New records may include the same
  `provenance`; ephemeral preview structure is not duplicated in persistence.

All objects are strict and use the identifier, entry, code-point, UTF-8, item, and serialized limits
owned by [Protocol](protocol.md) and [Security](security.md). A Tool Call and matching Result remain
one indivisible context and recovery unit. A Resource or Prompt event is written only when its
snapshot or confirmed projection is actually attached to the Run; browsing, list refresh, read
preview, Prompt preview, cancellation, or rejection creates no content event.

Tool schemas, descriptors, annotations, list cursors, connection snapshots, raw Prompt templates,
unconfirmed previews, Resource catalogs, process state, executable, arguments, cwd, environment,
stdout, stderr, SDK/JSON-RPC values, Server error data, approvals, and credentials are forbidden.
`displayName` is not persisted because `serverId` is the stable provenance identity and the current
configuration label may change independently.

### Negotiated provenance (T1804)

For an operation that completed a successful handshake, `provenance` is the strict bounded object:

```text
{
  configuredMode: "modern-only" | "dual",
  negotiatedEra: "modern" | "legacy",
  negotiatedVersion: "2026-07-28" | "2025-11-25"
}
```

The pair is constrained: `modern` is only `2026-07-28`, and `legacy` is only `2025-11-25`.
`modern-only` cannot carry legacy provenance. The field is historical evidence for the exact
Tool/Resource/Prompt outcome; it is never a capability snapshot, approval, retry token, config copy,
connection identity, or reconnect instruction. Version `1` events written before T1804 may omit the
field and remain readable; new events write it whenever a negotiated connection exists. Missing
provenance is not upgraded by guessing or by reading current configuration.

Probe responses, fallback attempts or timing, failed negotiations, process state, command/args/cwd,
environment, credentials, SDK/JSON-RPC errors, Server metadata, and raw protocol values are never
persisted. Recovery displays provenance only as bounded historical text and performs no connect,
probe, fallback, renegotiation, Tool call, Resource read, Prompt get, approval, or catalog refresh.

### Compatibility and recovery

- A pre-MCP version `1` Session contains none of these events and restores normally with no MCP
  provenance or placeholder. Current readers validate every recognized MCP event strictly; invalid
  source identity, mismatched Tool Call/Result provenance, unsupported content, excessive data, or
  an impossible lifecycle makes the current-version Session corrupt rather than guessed or repaired.
- The events are additive because the event envelope already admits later dotted types and no
  existing record meaning changes. A legacy reader may ignore the bounded provenance field and retain
  the history it already understands. Any future change to its field meaning, role projection,
  identity mapping, or replay semantics requires a new persisted-format decision and compatibility
  fixtures.
- Recovery may display completed MCP Tool outcomes and reconstruct bounded Resource/Prompt ordinary
  context provenance. Persisted generation, snapshot ID, or Tool identity
  is historical evidence only and cannot match, authorize, or seed a new live connection.
- Recovery never reads MCP configuration for side effects, starts or reconnects a Server, lists a
  primitive, sends JSON-RPC, refreshes a snapshot, consumes an approval, repeats a Tool Call, reads a
  Resource, gets a Prompt, or resubmits confirmed content. A live or incomplete MCP operation is
  normalized through the existing Session recovery rule to `interrupted`; it has no ordinary Tool
  Result and cannot resume.
- A later explicit connection creates a new generation and new catalogs. It cannot replace text in
  an already persisted Resource snapshot or Prompt projection, even if the same Server ID, URI, or
  Prompt name now returns different content.

### MCP fixtures

Version `1` compatibility fixtures added by the implementation tasks must cover complete modern and
legacy Tool Call/Result provenance, a truncated Resource snapshot, a confirmed multi-message Prompt
projection, a pre-MCP Session, an interrupted call without a Result, missing/old provenance,
mismatched Server or era/version provenance, unsupported content, limit overflow, extra fields, and
tail damage. They use deterministic fake Server identities and content and never start a Server or
contain a developer configuration, command, path, environment, or real credential.
