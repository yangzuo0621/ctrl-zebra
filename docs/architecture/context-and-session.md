
## Context Budget and Recovery Boundary

- Core owns context budgeting, history pruning, summarization policy, repetition detection, and
  Provider retry decisions. Provider adapters report normalized events and stable errors but do not
  spend budgets, retry themselves, or choose content to discard.
- A declared model context window must be a positive safe integer no greater than 2,000,000 tokens.
  The default budget allocator assigns the whole declared window with integer weights of 10% System,
  50% History, 25% Files, and 15% Tools. Integer division rounds each share down, then assigns the
  remainder one token at a time in the fixed order System, Tools, History, Files. The calculation is
  deterministic, uses no floating-point ratios, and the four categories always sum to the declared
  window without exceeding any category's weighted ceiling by more than one token.
- Token counts entering a budget decision are conservative estimates supplied through a Core-owned
  counter contract. A missing, negative, fractional, unsafe, or over-limit count is invalid input;
  the runtime never treats an unknown count as zero or continues with an unbounded value.
- Context construction treats a Tool Call and its matching Tool Result as one indivisible history
  unit. Pruning, summarization, and retry recovery may retain or remove the pair together but must
  never create an orphan Tool Result or a Tool Call whose completed result was discarded.
- Every bounded producer records truncation in structured metadata that survives later budgeting.
  Text-only ellipses are not sufficient. T0702 applies per-value hard limits of 65,536 Unicode code
  points, 2,000 lines, and 500 collection entries before the existing 1,048,576-byte serialized Tool
  Result ceiling; reaching any applicable limit sets the truncation marker.
- The newest user message is the protected recent-intent unit. History pruning and summarization do
  not remove or rewrite it. If that message alone exceeds its assigned hard budget, context building
  may include only a bounded prefix with an explicit structured truncation marker and must not spend
  another category's budget to conceal the overflow.
- A persisted summary is untrusted derived user content, never a System message or executable Tool
  Call. It is limited to 32,768 Unicode code points, records the covered message range, preserves
  unresolved user requests and material decisions, and must not claim facts absent from its source.
  Summary generation receives complete Tool Call/Result pairs and cannot authorize or replay tools.
- One model turn may perform at most one context-overflow recovery retry. The retry must strictly
  reduce estimated input tokens; otherwise recovery stops. A second overflow is terminal for that
  Run. Summary generation remains separately bounded to at most one operation where a later task
  supplies an approved summarizer. The exported Core recovery helper enforces the same one-retry
  bound and does not invoke a summarizer; summary recovery remains deferred until that contract is
  explicitly supplied.
  Provider retry policy may perform at most two retries after the initial attempt, and tool
  repetition detection must pause at a configured threshold no greater than 10 consecutive matching
  calls. Cancellation ends every recovery, retry, delay, summary, and tool-loop action immediately.

IDE context uses the same budget authority rather than creating a second quota:

- One editor/selection text value is bounded before allocation to at most 65,536 Unicode code points,
  2,000 logical lines, and 262,144 UTF-8 bytes. Empty text is one logical line; LF ends a line,
  CRLF is one delimiter, and a terminal delimiter creates the following empty line. A producer scans
  scalars and delimiters incrementally, stops before the candidate that would create line 2,001 (or
  exceed either byte/scalar limit), and never leaves a dangling CR. A diagnostic or language-service
  collection is at most 256 entries; every message, label, path, symbol name, and range is independently
  bounded by the Protocol/Security string limits. Position line is `0..1,999`; `character` preserves
  the VS Code 0-based UTF-16 code-unit offset `0..131,072` inclusive, cannot split a surrogate pair,
  and cannot exceed that line's actual UTF-16 length. The complete normalized Tool Result remains at
  most the existing 1,048,576-byte UTF-8 ceiling.
- The Host estimates tokens before context construction. IDE content may consume only the currently
  allocated Files budget (at most 25% of the declared model window, never more than the existing
  2,000,000-token context window); an unknown, invalid, or over-budget estimate follows the stable
  bounded truncation/limit outcome and never spends another category's budget. DTOs do not expose a
  token estimate as authority.
- Every limit decision is represented by structured `truncated`/`truncationReasons` metadata. A text
  ellipsis, omitted location, or shorter array without that metadata is invalid and cannot be treated
  as complete source.

### Multi-turn history projection

- A Session is the durable owner of one ordered transcript and may contain multiple sequential Runs.
  A Run is one user submission, one model/Tool loop, and one terminal outcome; there is no separate
  Conversation aggregate in this phase.
- Extension recovery projects model history from the validated Session event log in committed
  sequence order. It includes every validated user message, complete assistant text only when its Run
  reached a normal `completed` outcome, and complete assistant Tool Call/Tool Result pairs whose call
  ID and name match. Reasoning, status, approval, usage, summary, attachment, and UI-source events
  never become model messages.
- A truncated, cancelled, failed, or recovery-interrupted Run keeps its user message for the next Run. Partial or
  unconfirmed assistant text is discarded. A Tool Call/Result pair committed before the terminal
  outcome may remain in order; an open call, orphan result, or mismatched pair is never injected and
  never receives a synthetic result.
- The newest user message is appended only after prior history has been validated. A continuation
  never replays a persisted approval, Tool, Provider request, or side effect. History remains
  untrusted model context and is bounded before constructing an unbounded array or string.

## Session State Machine

- Session status changes go through the Core state machine; callers and tools do not mutate or
  bypass the current status.
- Legal live transitions are `idle → preparing`; `preparing → streaming | cancelled | failed`;
  `streaming → awaiting_approval | executing_tool | completed | truncated | cancelled | failed`;
  `awaiting_approval → streaming | executing_tool | cancelled | failed`; and
  `executing_tool → streaming | cancelled | failed`.
- `completed`, `truncated`, `cancelled`, and `failed` are distinct terminal outcomes for the most recent Run.
  They have no ordinary outgoing transitions. An explicit Core-owned `beginRun` reset gate may move
  any of those outcomes to `preparing` for one newly allocated Run; it is not a status mutation that
  resumes the prior Run.
- `interrupted` is a recovery-only status. Recovery normalizes `idle`, `preparing`, `streaming`,
  `awaiting_approval`, and `executing_tool` to `interrupted`; it never resumes a persisted model,
  approval, or Tool operation. A later explicit `beginRun` may reset `interrupted` to `preparing`,
  with a fresh Run identity and fresh cancellation/resource ownership, but no automatic continuation
  is allowed.
- A Session accepts at most one active Run. Submitting while another Run, restore, or Session switch
  owns the Session fails closed and cannot be redirected to another Session.
- Every Run receives a host/Core-generated opaque Run identity distinct from Session ID, message ID,
  and transport request ID. The identity is carried into approval/checkpoint/diagnostic ownership and
  is never selected by Webview or model data. A Run owns its `AbortSignal`, event gate, Tool steps,
  and transient resources; none may be reused by a later Run.
- An illegal transition fails with a domain error without changing state or emitting an event.
- A legal transition commits the new status before synchronously emitting exactly one status-change
  event. Event-sink failures propagate and do not roll back the committed status.
