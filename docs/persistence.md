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
  drive prefixes, URI syntax, or platform-specific reserved characters.
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
