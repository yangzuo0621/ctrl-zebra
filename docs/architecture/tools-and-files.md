
## Tool Contract Boundary

- `packages/protocol` owns the strict, JSON-serializable Schemas and inferred types for Tool Call,
  Tool Result, tool risk, and structured tool errors. `packages/core` consumes and may re-export
  those contracts for the Provider boundary; it must not define a second Tool Call shape.
- A Tool Call contains an opaque call ID, a stable lower `snake_case` tool name, and generic JSON
  input. Provider adapters validate that generic envelope before emitting it. This validation does
  not authorize execution or replace the selected tool's input Schema, which parses from `unknown`
  immediately before execution in T0403.
- The risk set is the closed union `read`, `write`, `execute`, and `network`. Risk belongs to the
  registered tool definition and policy, not to model-supplied Tool Call input; model output cannot
  lower or choose a tool's risk.
- A Tool Result is a strict discriminated union tied to the exact call ID and tool name. Success
  carries JSON output and an explicit truncation flag. Failure carries a stable error code and a
  user-safe message; raw exceptions, SDK failures, host values, and arbitrary diagnostic objects do
  not cross this boundary.
- The normalized result has a 1,048,576-byte UTF-8 serialized ceiling. Producers apply the limit
  before constructing the result so the boundary never needs to retain an unbounded value merely to
  reject it; the shared Schema enforces the ceiling as defense in depth.
- The executor converts expected tool failures into structured error results. Cancellation remains
  a separate run outcome, propagates through the run-owned `AbortSignal`, and produces no ordinary
  Tool Result after cancellation.
- Tools do not own Agent control flow. A tool can return data or a structured failure, but cannot
  mutate Session status, emit lifecycle transitions, continue the model loop, approve an operation,
  or choose presentation state. Those responsibilities remain in the Core runtime and its injected
  services.
- Core may report an approval-preparation or Tool-execution failure through an injected, local-only
  diagnostic sink. The diagnostic carries the owning Session, Run, and Tool Call identities plus the
  internal cause for host logging; it is not an `AgentRuntimeEvent` and therefore cannot enter the
  Webview, Protocol, persistence, model history, or Tool Result.

## File lifecycle and atomic WorkspaceEdit boundary (T2001)

The existing `propose_file_edit` remains the deep module for one existing text document. Its parser,
revision capture, `TextEditPlan`, Diff Presenter, and WorkspaceEdit applier are reused by the new
file lifecycle surface; they are not copied into a second generic file utility. T2001 fixes three
new preparation Tool names—`propose_file_create`, `propose_file_delete`, and
`propose_file_rename`—plus `propose_workspace_edit` for one edit-only plan over multiple existing
text documents. All are Host-integrated `write` Tools and are exposed through the existing Tool
Registry/approval workflow. A Tool preparation never writes, consumes approval, or creates a
Checkpoint.

`packages/builtin-tools` owns strict, host-independent input parsing and plan normalization. It
does not resolve `vscode.Uri`, read files, decide Trust, compute canonical identity, persist a
Checkpoint, or call `WorkspaceEdit`. `apps/extension` owns the workspace adapter, canonical path
and symlink/junction checks, text/binary decoding, revision capture, Diff Presenter integration,
approval binding, Checkpoint durability, and one atomic WorkspaceEdit submission. `packages/core`
owns only the plan/approval lifecycle and stable outcome mapping; it never accesses a filesystem.
The Webview receives the existing approval projection and asks the Host to open the temporary Diff;
it cannot edit a plan or submit a mutation directly.

The Core/Extension approval lifecycle keeps `approved` (grant) and `consumed` (one-time terminal
claim) as internal state vocabulary. Existing `propose_file_edit` retains its current public
success payload `{ outcome: "approved" }`; the additive lifecycle Tools expose `{ outcome: "applied" }`
only after consumption, durable Checkpoint creation, and successful atomic application. This
distinction prevents an approval grant or internal consume response from being mistaken for a
public claim that a lifecycle mutation completed.

The immutable `FileMutationPlan` is a structural value with operation kind, ordered canonical target
identities, before/after existence and revisions, normalized edits or content, and deterministic
presentation digest. Paths, revisions, hashes, Trust, selected-root identity, approval lifetime,
and Checkpoint IDs are Host-derived. `propose_workspace_edit` sorts targets deterministically,
rejects duplicate targets and overlapping edits, and deliberately rejects create/delete/rename
actions so one operation cannot have ambiguous preconditions or restoration semantics.

The Extension rechecks all plan preconditions in the owner queue immediately before approval
consumption, durably creates one Checkpoint, then submits one host-owned `WorkspaceEdit`. Any
validation or persistence failure precedes submission and causes zero writes. A false/throwing
`applyEdit` result is a failure with no success claim; the Checkpoint is retained for explicit
reconciliation. Cancellation closes the run-owned gate before each asynchronous boundary and
prevents every later message, retry, Tool continuation, approval consumption, or side effect.

Create/delete/rename and multi-file edit recovery use the same Checkpoint owner and atomic restore
port. Absence is a first-class before/after state rather than an empty string. Existing v1
Checkpoint records remain readable; a consumer that does not understand the additive state union
rejects new lifecycle records instead of applying an unsafe empty-file interpretation. No automatic
rollback, force overwrite, directory recursion, or workspace-outside operation is introduced.

The existing `search_files` owner also remains in `packages/builtin-tools`. Literal substring search
is unchanged. An explicit `mode: "regex"` selects the product's bounded RE2-compatible dialect;
the engine is an implementation detail behind a package-local controlled interface. The owner
rejects unsupported backreferences/look-around/engine extensions, enforces pattern/program/input
complexity limits, yields to `AbortSignal`, and preserves existing file/result truncation. T2005
owns engine selection and tests; T2001 does not add a dependency or a regex runtime.
