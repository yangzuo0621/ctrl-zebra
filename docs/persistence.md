# Persistence Contract

This document owns durable layout, record validation, cleanup, recovery, and compatibility. Values
read from storage are untrusted and are validated before Core values are constructed. Configuration
owns setting names and bounds; [Security](security.md) owns data-exposure and authorization rules;
[Protocol](protocol.md) and [Webview](ux.md) own boundary and presentation projections.

## Storage layout and format version

The Extension owns the storage root. Core and Protocol use portable relative path segments and never
access a filesystem directly.

```text
<storage-root>/
├── sessions/v1/<encoded-session-id>/
│   ├── manifest.json
│   ├── messages.jsonl
│   └── events.jsonl
└── checkpoints/v1/<encoded-checkpoint-id>.json
```

- The current format is positive integer version `1`, represented by the `v1` directories and the
  manifest version. File names and directory components are persisted-format constants.
- Session and Checkpoint IDs are well-formed Unicode values of at most 100 UTF-8 bytes, encoded as
  lowercase hexadecimal UTF-8 bytes before becoming one portable path segment. The encoded value
  cannot contain separators, dot segments, drive prefixes, URI syntax, or reserved characters.
- Path helpers return relative segments. Only a trusted Host adapter joins them to its storage URI.
  A format change requires a new version decision; callers must never interpret these segments as
  absolute filesystem paths.

## Session deletion and local-history clearing

Deletion is explicit and Host-owned. A validated opaque Session ID is encoded through the persistence
path helper and removes only that Session directory, including its manifest, JSONL files, and owned
atomic-write siblings. A missing directory is an idempotent no-op; an invalid ID is rejected before
storage access.

Checkpoints are independent files. Deleting one Session scans the bounded Checkpoint directory and
removes only valid or safely attributable records whose `sessionId` exactly matches it, including the
matching temporary file. Malformed or unattributable records remain and produce a partial result.

Clear-all is explicit and idempotent. It removes every Session directory and committed or temporary
Checkpoint file under the versioned persistence directories, plus only Extension-owned storage and
mementos included by the all-data controller. It never removes workspace files, user code, unrelated
VS Code storage, another Extension's data, Provider settings, or credentials. Each category reports
bounded deleted/failed counts; a later failure remains partial and the operation is safe to retry.
Recovery and list readers never expose a removed Session, and a stale restore result cannot recreate
its Webview projection.

## Session retention

Retention is controlled by the machine-scoped settings in [Configuration](configuration.md#session-retention-settings).
[Architecture](architecture/context-and-session.md#session-retention-lifecycle) owns cutoff, trigger,
protected states, locking, cancellation, and result lifecycle. Persistence compares the manifest's
existing `updatedAt` with the injected UTC cutoff using `<=`, scans at most 10,000 bounded manifests,
and does not load event logs during candidate collection.

An expired Session is removed through exact encoded-directory deletion, then its owned Checkpoints are
removed by one bounded scan. Only a validated Checkpoint with an exactly matching `sessionId` is
attributable. Invalid, unreadable, or unattributable records remain and count as failures. Cleanup is
local-only and retains bounded `scanned`, `expired`, `protected`, `removed`, and `failed` counts.

## Complete local-data clearing

The all-data controller owns confirmation, locks, cancellation, SecretStorage, process cleanup, and
redaction. Persistence owns Session, Checkpoint, and Extension-storage portions. It introduces no
format migration and a later request retries remaining categories.

The workspace `storageUri` cleanup removes only direct Extension-owned entries outside `sessions` and
`checkpoints`; `globalStorageUri` is scanned separately for CtrlZebra temporary/cache artifacts.
Missing roots are empty and safe to retry. One category failure does not suppress later categories,
and no partial result is reported complete. Restart does not resume cleanup or recreate deleted data.

## File responsibilities and writes

### `manifest.json`

The manifest is one UTF-8 JSON object without a byte-order mark. It contains format version, Session
identity/status, creation and update timestamps, and the last committed event sequence. Unknown fields
are rejected. `lastEventSequence` is `0` before the first event and otherwise equals the greatest
committed sequence. A Session is invisible to readers until a valid manifest exists.

### `messages.jsonl`

Each non-empty line is one complete UTF-8 JSON Chat Message object. Records are append-ordered, end in
LF, are not pretty-printed, and are never split across lines.

### `events.jsonl`

Each non-empty line is one complete UTF-8 JSON object with a positive contiguous `sequence`, RFC 3339
`recordedAt`, stable dotted `type`, and strict JSON-serializable `data`. Records end in LF and are
never rewritten in place. The ordered event log is the source for history reconstruction;
`messages.jsonl` is a bounded display/compatibility projection, not an authorization source.

## Session, Run, and history projection

- A Session is an append-only transcript of sequential Runs. Each Run has a fresh opaque identity and
  one submission, model/Tool loop, and terminal outcome.
- History projects validated user messages, assistant text only from normally completed Runs, and
  complete matching Tool Call/Result pairs. Reasoning, status, approval, usage, summary, MCP
  attachment metadata, Webview-only source fields, and IDE read-only projections remain outside model
  history. A Tool pair is indivisible.
- Truncated, cancelled, budget-exceeded, failed, and interrupted Runs keep the user message. Partial
  assistant text is not injected. A complete Tool pair may remain; open calls, orphan results,
  duplicate IDs, and mismatches make the Session corrupt unless they are the expected unfinished tail.
  No synthetic Result, assistant end, or recovery event is written.
- Context pruning may remove old units later but never rewrites persisted history or removes the
  newest user message to hide an overflow.

### Regeneration

Regeneration appends a new user event and a strict additive `session.regeneration` relation containing
only `{ targetMessageId, replacementUserMessageId }`. The Host requires the target to be the latest
completed assistant projection and builds the replacement from the validated prefix. Existing source
events, Tool operations, Provider requests, and approvals are never replayed. A completed relation
replaces the old assistant projection; until then, the old answer remains visible. Failed, cancelled,
truncated, damaged, or incomplete replacements preserve it.

### Historical editing

Editing appends a new user event and a strict `session.edit` relation with the same identifier-only
shape. The Host requires an exact completed user projection, builds a new Run from the prefix plus new
content, and never executes old Tools. A completed relation overlays the target and hides the old
suffix while retaining immutable source events. The latest completed relation wins; an incomplete,
cancelled, failed, or truncated replacement falls back to the prior completed projection. Orphaned,
duplicate, out-of-order, cross-Session, or malformed relations make the Session corrupt.

## Ephemeral IDE and workspace-file context

Pending editor/selection attachments, active-editor identity, URI, range, document version, stale or
truncation state, diagnostics, language-service results, file-reference IDs, fingerprints, and
unsubmitted text are never written to Session files, restoration state, logs, or a separate memory
store. Switching Session/editor, New chat, cancellation, Trust loss, workspace changes, or disposal
discards them without an event.

When the user explicitly submits bounded IDE or file text, it becomes ordinary user context and only
that resulting user message follows normal persistence. Recovery never re-reads, reconstructs, or
silently reattaches a historical source reference. No persistence migration or new durable projection
is implied by editor context.

## Corruption, recovery, and resource ceilings

- Duplicate/skipped sequences, invalid recognized payloads, cross-Session identities, orphaned or
  mismatched Tool pairs, duplicate Tool IDs, and invalid lifecycle order make the Session corrupt.
  Readers never guess, reorder, silently repair, or fall back to another Session.
- A truncated or invalid final non-empty JSONL record is tail damage: preceding valid records remain,
  a damaged-tail marker is surfaced, and interrupted work is not resumed. Invalid records before the
  final non-empty line make the file corrupt.
- Readers select a decoder from the version directory and require the manifest version to match.
  Missing, unsupported, or mismatched versions are isolated. Current readers reject unknown fields.
  Structural or semantic incompatibility requires a new version directory and explicit migration;
  source data is never rewritten in place or exposed before the destination is complete.
- Recovery normalizes active statuses to `interrupted`, preserves terminal statuses, and performs no
  model, Tool, approval, Provider, or other side effect. An explicit later submit may reset a writable
  recovered Session to a new Run. Recognized legacy single-turn v1 Sessions are read-only historical
  projections and cannot be continued, edited, or regenerated.
- Version `1` readers enforce bounded input before allocation: each event record is at most
  1,048,576 bytes, each event log 16,777,216 bytes, each event/message collection 10,000 records,
  submitted content 1,000,000 characters, Session IDs 100 persisted bytes, and model context
  2,000,000 estimated tokens. A limit violation is bounded failure or corruption, never silent
  fallback or unbounded allocation.

### Reasoning summary events

Persistence stores only the bounded user-visible reasoning projection as additive v1 events:
`session.reasoning-start { blockId }`, `session.reasoning-delta { blockId, text }`,
`session.reasoning-end { blockId, truncated }`, and the strict limit marker defined by Protocol.
Limits are applied before append: at most 32 blocks, 32,768 code points/131,072 bytes per block,
65,536 code points/262,144 bytes per Run, and 8,192 code points/32,768 bytes per delta.

Events retain source order with text, Tool, usage, and status events. A valid start/delta/end lifecycle
recovers as complete; an open block at terminal status or tail damage recovers as bounded partial
without a synthetic end. Invalid lifecycle, duplicate/nested starts, unmatched deltas/ends, or
inconsistent limits make the Session corrupt. Reasoning is not a Chat Message or model-history item.

### Provider usage and Run budget events

`session.usage` stores only bounded actual non-negative `inputTokens`, `outputTokens`, and
`totalTokens` values (each at most 2,000,000). Recovery sums fields independently; absent values stay
unknown, and overflow or malformed payload is corrupt. Prices, estimates, SDK metadata, and raw
responses are excluded.

`session.run-budget` stores bounded warning/exceeded snapshots. Within one Run, at most one warning
may precede one exceeded snapshot; values are monotonic and `effectiveTokens` is the greatest
observed count. Budget events remain outside model history and never resume work. A cancellation
immediately after exceeded retains the cancelled outcome; other incompatible terminal ordering is
corrupt.

## Checkpoint durability and recovery

A Checkpoint is one immutable record for one file-mutation operation. It has a Host-generated ID,
Session/Run IDs, creation timestamp, and a non-empty ordered set of distinct canonical targets. Each
target stores bounded pre-operation UTF-8 text or an explicit absent state plus lowercase SHA-256
`beforeHash`/`afterHash`. Proposed after-content, Diff text, URI objects, and secrets are not persisted.

The complete record is schema/integrity checked, written to a sibling `.tmp`, flushed/closed, and
atomically renamed before the first WorkspaceEdit. The v1 record is at most 4,194,304 bytes and has
at most 128 targets. Duplicate IDs, state/hash mismatches, target overflow, or commit failure
authorize no workspace mutation. A committed Checkpoint remains after a later apply failure for
reconciliation.

Recovery is explicit and all-target. It verifies every current target's canonical identity and
after-state hash, then revalidates scope and hashes immediately before one atomic operation. Create
removes only the unchanged created file; delete recreates only an absent file; rename reverses only
the exact source/target pair; multi-file edit restores the complete set. Any missing, unreadable,
binary, out-of-scope, or mismatched target is one conflict and leaves every target unchanged. After
restore, before hashes are verified.

Lifecycle records use the additive target-state union:

```text
before: { kind: "absent" } | { kind: "text", content, beforeHash }
after:  { kind: "absent" } | { kind: "text", afterHash }
```

Existing one-file records remain readable. A reader that cannot validate the union rejects the record
as unsupported/corrupt and never treats absent as empty text. Any change to state meaning, identity,
restore semantics, or limits requires a new persisted-format decision.

## Secret exclusion

Persistence contains conversation and operational history, never credentials. API keys, SecretStorage
values or names, authorization headers, environment secrets, raw third-party errors, and credential-
bearing request metadata are forbidden in manifests, messages, events, temporary files, logs, and
snapshots. Stable safe error categories may be persisted only when their schema permits them.

## MCP persistence projection

MCP persistence stores bounded conversation-visible outcomes and provenance, never a live Client,
connection capability, probe/fallback state, replayable authorization, or user-scoped configuration.

The extensible v1 event envelope admits strict additive records for MCP Tool Call/Result, attached
Resource snapshots, and confirmed Prompt projections. They contain only validated bounded content,
stable Server/registry identity, generation, and optional negotiated provenance. Browsing, catalog
refresh, preview, cancellation, rejection, and incomplete operations create no content event.

The provenance object, when a handshake completed, is:

```text
{
  configuredMode: "modern-only" | "dual",
  negotiatedEra: "modern" | "legacy",
  negotiatedVersion: "2026-07-28" | "2025-11-25"
}
```

`modern` pairs only with `2026-07-28`; `legacy` only with `2025-11-25`; `modern-only` cannot carry
legacy provenance. Provenance is historical evidence for one outcome, not a capability snapshot,
approval, reconnect instruction, or current configuration. Missing provenance is not guessed.

Current readers validate recognized MCP events strictly. Invalid identity, mismatched provenance,
unsupported content, excessive data, or impossible lifecycle makes the Session corrupt. Recovery may
display bounded historical MCP outcomes but never starts/reconnects a Server, sends JSON-RPC, refreshes
a catalog, consumes approval, repeats a Tool, reads a Resource, or gets a Prompt. A later connection
uses a new generation and cannot replace persisted Resource or Prompt text.
