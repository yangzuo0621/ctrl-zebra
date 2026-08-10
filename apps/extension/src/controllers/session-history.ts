import type { ModelMessage, SessionRecord, ToolCall, ToolResult } from "@ctrl-zebra/core";
import {
  type SessionStatus,
  sessionStatusSchema,
  toolCallSchema,
  toolResultSchema,
  type UserMessage,
  userMessageSchema,
} from "@ctrl-zebra/protocol";

const maxHistoryMessages = 10_000;
const maxMessageCharacters = 1_000_000;

const activeStatuses = new Set<SessionStatus>([
  "preparing",
  "streaming",
  "awaiting_approval",
  "executing_tool",
]);

const terminalStatuses = new Set<SessionStatus>([
  "completed",
  "cancelled",
  "failed",
  "interrupted",
]);

const legalTransitions: Readonly<Record<SessionStatus, readonly SessionStatus[]>> = {
  idle: ["preparing", "interrupted"],
  preparing: ["streaming", "cancelled", "failed", "interrupted"],
  streaming: [
    "awaiting_approval",
    "executing_tool",
    "completed",
    "cancelled",
    "failed",
    "interrupted",
  ],
  awaiting_approval: ["streaming", "executing_tool", "cancelled", "failed", "interrupted"],
  executing_tool: ["streaming", "cancelled", "failed", "interrupted"],
  completed: ["preparing"],
  cancelled: ["preparing"],
  failed: ["preparing"],
  interrupted: ["preparing"],
};

export class SessionHistoryCorruptError extends Error {
  constructor() {
    super("The saved Session history is corrupt.");
    this.name = "SessionHistoryCorruptError";
  }
}

type HistoryUnit =
  | { readonly kind: "assistant"; readonly content: string }
  | { readonly kind: "tool"; readonly call: ToolCall; readonly result: ToolResult };

interface PendingToolCall {
  readonly call: ToolCall;
  readonly statuses: Set<"pending" | "running">;
}

interface RunProjection {
  readonly user: UserMessage;
  readonly units: HistoryUnit[];
  readonly pendingToolCalls: Map<string, PendingToolCall>;
  readonly textParts: string[];
  textCharacters: number;
  status: SessionStatus;
  terminalStatus?: TerminalRunStatus;
  sawStatus: boolean;
}

type TerminalRunStatus = Extract<
  SessionStatus,
  "completed" | "cancelled" | "failed" | "interrupted"
>;

/**
 * Projects only validated, committed Session events into untrusted model context.
 * Display projections and persisted operational events intentionally remain outside this function.
 */
export function projectSessionModelHistory(record: SessionRecord): readonly ModelMessage[] {
  const history: ModelMessage[] = [];
  const seenToolCallIds = new Set<string>();
  const hasStatusEvents = record.events.some(
    ({ event }) => event.type === "session.status-changed",
  );
  let currentStatus: SessionStatus = hasStatusEvents ? "idle" : record.manifest.status;
  let currentRun: RunProjection | undefined;

  for (const persisted of record.events) {
    const event = persisted.event;

    if (event.type === "session.user-message") {
      const user = parseUserMessage(event.data, record.manifest.sessionId);
      if (currentRun !== undefined) {
        closeRun(currentRun, history, record.manifest.status, false, false);
        currentRun = undefined;
      }
      currentRun = {
        user,
        units: [],
        pendingToolCalls: new Map(),
        textParts: [],
        textCharacters: 0,
        status: currentStatus,
        sawStatus: false,
      };
      continue;
    }

    if (event.type === "session.status-changed") {
      if (currentRun === undefined) {
        throw new SessionHistoryCorruptError();
      }
      if (currentRun.terminalStatus !== undefined) {
        throw new SessionHistoryCorruptError();
      }
      const { previousStatus, status } = parseStatusChange(event.data);
      if (previousStatus !== currentStatus || !legalTransitions[currentStatus].includes(status)) {
        throw new SessionHistoryCorruptError();
      }
      currentStatus = status;
      currentRun.status = status;
      currentRun.sawStatus = true;
      if (isTerminalRunStatus(status)) {
        currentRun.terminalStatus = status;
      }
      continue;
    }

    if (event.type === "agent.text-delta") {
      if (currentRun === undefined) {
        throw new SessionHistoryCorruptError();
      }
      appendText(currentRun, event.data);
      continue;
    }

    if (event.type === "agent.tool-state") {
      if (currentRun === undefined) {
        throw new SessionHistoryCorruptError();
      }
      projectToolState(currentRun, event.data, seenToolCallIds);
    }

    // Reasoning, approval, usage, attachment, MCP provenance, and future events are not
    // model messages. Their own persistence schemas validate recognized payloads upstream.
  }

  if (currentRun !== undefined) {
    closeRun(currentRun, history, record.manifest.status, record.eventLogTailDamaged, true);
  }

  return history;
}

function closeRun(
  run: RunProjection,
  history: ModelMessage[],
  manifestStatus: SessionStatus,
  finalTailDamaged: boolean,
  allowUnfinishedTail: boolean,
): void {
  let outcome = run.terminalStatus;

  if (outcome === undefined && !run.sawStatus) {
    // Early v1 Sessions did not persist status transitions. A run that ends before a
    // subsequent user message is assigned the manifest's terminal outcome when available.
    outcome = isTerminalOutcome(manifestStatus);
  }

  if (outcome === undefined) {
    if (!run.sawStatus || activeStatuses.has(run.status) || finalTailDamaged) {
      outcome = undefined;
    } else {
      throw new SessionHistoryCorruptError();
    }
  }

  if (!allowUnfinishedTail && outcome === undefined) {
    throw new SessionHistoryCorruptError();
  }

  flushText(run);
  appendHistoryMessage(history, { role: "user", content: run.user.content });

  const retainAssistantText = outcome === "completed";
  for (const unit of run.units) {
    if (unit.kind === "tool" || retainAssistantText) {
      appendHistoryUnit(history, unit);
    }
  }

  // A completed Run cannot end with a Tool Call lacking its Result. Cancellation,
  // failure, interruption, and damaged tails deliberately discard that unfinished tail.
  if (run.pendingToolCalls.size > 0 && outcome === "completed") {
    throw new SessionHistoryCorruptError();
  }
}

function isTerminalOutcome(status: SessionStatus): TerminalRunStatus | undefined {
  return isTerminalRunStatus(status) ? status : undefined;
}

function isTerminalRunStatus(status: SessionStatus): status is TerminalRunStatus {
  return terminalStatuses.has(status);
}

function appendHistoryUnit(history: ModelMessage[], unit: HistoryUnit): void {
  if (unit.kind === "assistant") {
    if (unit.content.length === 0) {
      return;
    }
    appendHistoryMessage(history, { role: "assistant", content: unit.content });
    return;
  }

  appendHistoryMessage(history, { role: "assistant", toolCall: unit.call });
  appendHistoryMessage(history, { role: "tool", result: unit.result });
}

function appendHistoryMessage(history: ModelMessage[], message: ModelMessage): void {
  if (history.length >= maxHistoryMessages) {
    throw new SessionHistoryCorruptError();
  }
  history.push(message);
}

function flushText(run: RunProjection): void {
  if (run.textParts.length === 0) {
    return;
  }
  const content = run.textParts.join("");
  run.textParts.length = 0;
  run.textCharacters = 0;
  if (content.length > 0) {
    run.units.push({ kind: "assistant", content });
  }
}

function appendText(run: RunProjection, data: unknown): void {
  if (run.terminalStatus !== undefined) {
    throw new SessionHistoryCorruptError();
  }
  const record = requireExactRecord(data, ["text"]);
  if (typeof record.text !== "string" || record.text.length === 0) {
    if (record.text === "") {
      return;
    }
    throw new SessionHistoryCorruptError();
  }
  if (run.textCharacters > maxMessageCharacters - record.text.length) {
    throw new SessionHistoryCorruptError();
  }
  run.textParts.push(record.text);
  run.textCharacters += record.text.length;
}

function projectToolState(run: RunProjection, data: unknown, seenToolCallIds: Set<string>): void {
  if (run.terminalStatus !== undefined) {
    throw new SessionHistoryCorruptError();
  }
  const record = asRecord(data);
  const status = record?.status;
  if (status !== "pending" && status !== "running" && status !== "success" && status !== "error") {
    throw new SessionHistoryCorruptError();
  }

  const expectedKeys =
    status === "pending" || status === "running"
      ? ["call", "status"]
      : ["call", "result", "status"];
  const exact = requireExactRecord(record, expectedKeys);
  const callResult = toolCallSchema.safeParse(exact.call);
  if (!callResult.success) {
    throw new SessionHistoryCorruptError();
  }
  const call = callResult.data;
  const pending = run.pendingToolCalls.get(call.id);

  if (status === "pending") {
    if (pending !== undefined || seenToolCallIds.has(call.id)) {
      throw new SessionHistoryCorruptError();
    }
    seenToolCallIds.add(call.id);
    run.pendingToolCalls.set(call.id, { call, statuses: new Set(["pending"]) });
    flushText(run);
    return;
  }

  if (pending === undefined || !toolCallsEqual(pending.call, call)) {
    throw new SessionHistoryCorruptError();
  }

  if (status === "running") {
    if (pending.statuses.has("running")) {
      throw new SessionHistoryCorruptError();
    }
    pending.statuses.add("running");
    return;
  }

  const result = toolResultSchema.safeParse(exact.result);
  if (
    !result.success ||
    result.data.status !== status ||
    result.data.callId !== call.id ||
    result.data.name !== call.name
  ) {
    throw new SessionHistoryCorruptError();
  }
  run.pendingToolCalls.delete(call.id);
  flushText(run);
  run.units.push({ kind: "tool", call, result: result.data });
}

function parseUserMessage(data: unknown, sessionId: string): UserMessage {
  const result = requireSchema(data, (value) => {
    const parsed = requireUserMessage(value);
    return parsed !== undefined && parsed.sessionId === sessionId ? parsed : undefined;
  });
  if (result === undefined) {
    throw new SessionHistoryCorruptError();
  }
  return result;
}

function requireUserMessage(value: unknown): UserMessage | undefined {
  const result = userMessageSchema.safeParse(value);
  return result.success ? result.data : undefined;
}

function parseStatusChange(data: unknown): {
  readonly previousStatus: SessionStatus;
  readonly status: SessionStatus;
} {
  const record = requireExactRecord(data, ["previousStatus", "status"]);
  const previousStatus = sessionStatusSchema.safeParse(record.previousStatus);
  const status = sessionStatusSchema.safeParse(record.status);
  if (!previousStatus.success || !status.success) {
    throw new SessionHistoryCorruptError();
  }
  return { previousStatus: previousStatus.data, status: status.data };
}

function requireSchema<T>(value: unknown, parse: (value: unknown) => T | undefined): T {
  const parsed = parse(value);
  if (parsed === undefined) {
    throw new SessionHistoryCorruptError();
  }
  return parsed;
}

function requireExactRecord(
  value: unknown,
  expectedKeys: readonly string[],
): Record<string, unknown> {
  const record = asRecord(value);
  if (record === undefined || !hasExactKeys(record, expectedKeys)) {
    throw new SessionHistoryCorruptError();
  }
  return record;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null
    ? (value as Record<string, unknown>)
    : undefined;
}

function hasExactKeys(value: Record<string, unknown>, expectedKeys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function toolCallsEqual(left: ToolCall, right: ToolCall): boolean {
  return (
    left.id === right.id && left.name === right.name && jsonValuesEqual(left.input, right.input)
  );
}

function jsonValuesEqual(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }
  if (typeof left !== typeof right || left === null || right === null) {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    return left.every((value, index) => jsonValuesEqual(value, right[index]));
  }
  if (typeof left === "object" && typeof right === "object") {
    const leftObject = left as Record<string, unknown>;
    const rightObject = right as Record<string, unknown>;
    const leftKeys = Object.keys(leftObject).sort();
    const rightKeys = Object.keys(rightObject).sort();
    if (
      leftKeys.length !== rightKeys.length ||
      leftKeys.some((key, index) => key !== rightKeys[index])
    ) {
      return false;
    }
    return leftKeys.every((key) => jsonValuesEqual(leftObject[key], rightObject[key]));
  }
  return false;
}
