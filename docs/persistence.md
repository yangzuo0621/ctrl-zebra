# Persistence Contract

This document defines the durable session format introduced by T0601. Persistence adapters must
treat every value read from storage as untrusted and validate it before constructing Core values.

## Storage layout and format version

The Extension owns the storage root. Protocol and Core code deal only in portable relative path
segments and never access a filesystem directly.

```text
<storage-root>/
└── sessions/
    └── v1/
        └── <encoded-session-id>/
            ├── manifest.json
            ├── messages.jsonl
            └── events.jsonl
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
  all data files and its manifest have been committed successfully. Automatic migration is not part
  of T0601.

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

- `interrupted` is a persisted recovery-only terminal Session status. The live Agent Runtime never
  transitions into or out of it.
- On recovery, `idle`, `preparing`, `streaming`, `awaiting_approval`, and `executing_tool` are written
  back as `interrupted`. `completed`, `cancelled`, `failed`, and `interrupted` remain unchanged.
- Recovery may read history and update the manifest status only. It never resumes a model request,
  consumes an approval, executes a tool, or repeats any other persisted side effect.

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

Checkpoints are local recovery data and may contain workspace source text. They follow the existing
secret exclusion rules and must not enter model context, Webview state, logs, telemetry, or approval
presentation. T0801 introduces no retention duration, pruning rule, quota eviction, or automatic
deletion policy; such a policy requires separately planned work.

## Secret exclusion

Persistence contains conversation and operational history, never credentials. API keys,
authorization headers, SecretStorage values or keys, environment secrets, raw third-party errors,
and credential-bearing request metadata are forbidden in manifests, messages, events, temporary
files, logs, fixtures, and snapshots. Stable safe error categories may be persisted when their schema
allows it. Host adapters must redact before constructing persisted records; encryption is not a
substitute for excluding secrets.

## Test fixtures

- Fixtures live under a directory named for the format, such as `fixtures/persistence/v1/`.
- Every fixture includes a valid manifest whose version matches its directory. Tests state whether a
  fixture is valid, unsupported, tail-damaged, or corrupt; malformed fixtures are not reused as
  normal examples.
- Current-format fixtures are immutable compatibility evidence. A format change adds a new versioned
  fixture set instead of rewriting old fixtures.
- Fixtures use deterministic IDs, timestamps, sequences, LF endings, and obviously fake content.
  They must never contain user data or real secrets.
