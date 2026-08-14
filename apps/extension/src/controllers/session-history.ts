import type { ModelMessage, SessionRecord, ToolCall, ToolResult } from "@ctrl-zebra/core";
import {
  messageIdSchema,
  type PersistedEventRecord,
  persistedRegenerationEventPayloadSchema,
  type SessionStatus,
  sessionStatusSchema,
  toolCallSchema,
  toolResultSchema,
  type UserMessage,
  userMessageSchema,
} from "@ctrl-zebra/protocol";
import { hasExactKeys, isPlainRecord } from "../adapters/record-validation.js";
import { jsonValuesEqual } from "./json-values.js";

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
  "truncated",
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
    "truncated",
    "cancelled",
    "failed",
    "interrupted",
  ],
  awaiting_approval: ["streaming", "executing_tool", "cancelled", "failed", "interrupted"],
  executing_tool: ["streaming", "cancelled", "failed", "interrupted"],
  completed: ["preparing"],
  truncated: ["preparing"],
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

export interface RegenerationContext {
  readonly targetUserMessage: UserMessage;
  readonly targetAssistantMessageId: string;
  readonly history: readonly ModelMessage[];
}

/**
 * Builds the exact model input for a regeneration without replaying the target Run. The source
 * events remain immutable; only the new Run receives the history prefix before the target user
 * message. Assistant projection IDs are derived from the first persisted text delta, matching
 * Session recovery's stable display identity.
 */
export function projectRegenerationContext(
  record: SessionRecord,
  targetAssistantMessageId: string,
): RegenerationContext {
  if (record.eventLogTailDamaged) {
    throw new SessionHistoryCorruptError();
  }

  let targetUserIndex = -1;
  let targetUser: UserMessage | undefined;
  for (let index = 0; index < record.events.length; index += 1) {
    const persisted = record.events[index];
    if (persisted?.event.type !== "session.user-message") {
      continue;
    }
    const parsed = requireUserMessage(persisted.event.data);
    if (parsed === undefined || parsed.sessionId !== record.manifest.sessionId) {
      throw new SessionHistoryCorruptError();
    }
    targetUserIndex = index;
    targetUser = parsed;
  }

  if (targetUserIndex < 0 || targetUser === undefined) {
    throw new SessionHistoryCorruptError();
  }

  const expectedAssistantMessageId = findAssistantProjectionId(
    record.events.slice(targetUserIndex + 1),
  );
  if (
    expectedAssistantMessageId === undefined ||
    (expectedAssistantMessageId !== targetAssistantMessageId &&
      !isLiveAssistantProjectionAlias(targetAssistantMessageId))
  ) {
    throw new SessionHistoryCorruptError();
  }

  if (!hasCompletedTargetRun(record.events.slice(targetUserIndex + 1))) {
    throw new SessionHistoryCorruptError();
  }

  const suppressedUserMessageIds = new Set<string>();
  const projectedEvents = hideSupersededRunOutput(record.events, suppressedUserMessageIds);
  const targetUserSequence = record.events[targetUserIndex]?.sequence;
  if (targetUserSequence === undefined) {
    throw new SessionHistoryCorruptError();
  }
  const prefixRecord: SessionRecord = {
    manifest: { ...record.manifest, status: "completed" },
    events: projectedEvents.filter(({ sequence }) => sequence < targetUserSequence),
    eventLogTailDamaged: false,
  };
  return {
    targetUserMessage: targetUser,
    // Restored messages use this canonical sequence identity. A live Webview may still hold its
    // request-scoped `<requestId>:assistant` alias; persistence always records the canonical ID.
    targetAssistantMessageId: expectedAssistantMessageId,
    history: projectSessionModelHistory(prefixRecord),
  };
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
  readonly suppressUser: boolean;
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
  "completed" | "truncated" | "cancelled" | "failed" | "interrupted"
>;

/**
 * Projects only validated, committed Session events into untrusted model context.
 * Display projections and persisted operational events intentionally remain outside this function.
 */
export function projectSessionModelHistory(record: SessionRecord): readonly ModelMessage[] {
  const suppressedUserMessageIds = new Set<string>();
  const sourceEvents = hideSupersededRunOutput(record.events, suppressedUserMessageIds);
  const history: ModelMessage[] = [];
  const seenToolCallIds = new Set<string>();
  const hasStatusEvents = sourceEvents.some(({ event }) => event.type === "session.status-changed");
  let currentStatus: SessionStatus = hasStatusEvents ? "idle" : record.manifest.status;
  let currentRun: RunProjection | undefined;

  for (const persisted of sourceEvents) {
    const event = persisted.event;

    if (event.type === "session.user-message") {
      const user = parseUserMessage(event.data, record.manifest.sessionId);
      if (currentRun !== undefined) {
        closeRun(currentRun, history, record.manifest.status, false, false);
        currentRun = undefined;
      }
      currentRun = {
        user,
        suppressUser: suppressedUserMessageIds.has(user.messageId),
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

/**
 * A successful regeneration replaces only the projected answer. Its original source events stay
 * durable, but their assistant text and Tool pairs must not be fed into later model context.
 */
function hideSupersededRunOutput(
  events: readonly PersistedEventRecord[],
  suppressedUserMessageIds: Set<string>,
): readonly PersistedEventRecord[] {
  const hiddenSequences = new Set<number>();
  const seenTargets = new Set<string>();

  for (let relationIndex = 0; relationIndex < events.length; relationIndex += 1) {
    const relation = events[relationIndex];
    if (relation?.event.type !== "session.regeneration") {
      continue;
    }
    const parsed = persistedRegenerationEventPayloadSchema.safeParse(relation.event);
    if (!parsed.success || seenTargets.has(parsed.data.data.targetMessageId)) {
      throw new SessionHistoryCorruptError();
    }
    seenTargets.add(parsed.data.data.targetMessageId);

    const replacementUserIndex = events.findIndex(
      (candidate, candidateIndex) =>
        candidateIndex !== relationIndex &&
        candidate.event.type === "session.user-message" &&
        isUserMessageId(candidate.event.data, parsed.data.data.replacementUserMessageId),
    );
    if (replacementUserIndex < 0) {
      throw new SessionHistoryCorruptError();
    }
    if (suppressedUserMessageIds.has(parsed.data.data.replacementUserMessageId)) {
      throw new SessionHistoryCorruptError();
    }
    suppressedUserMessageIds.add(parsed.data.data.replacementUserMessageId);
    const replacementRunEnd = events.findIndex(
      (candidate, candidateIndex) =>
        candidateIndex > replacementUserIndex && candidate.event.type === "session.user-message",
    );
    const replacementEvents = events.slice(
      replacementUserIndex + 1,
      replacementRunEnd < 0 ? events.length : replacementRunEnd,
    );
    const replacementCompleted = hasCompletedTargetRun(replacementEvents);
    const replacementHasText = replacementEvents.some(
      ({ event }) => event.type === "agent.text-delta",
    );
    if (replacementCompleted && !replacementHasText) {
      throw new SessionHistoryCorruptError();
    }
    if (!replacementCompleted) {
      for (const replacementEvent of replacementEvents) {
        if (
          replacementEvent.event.type === "agent.text-delta" ||
          replacementEvent.event.type === "agent.tool-state"
        ) {
          hiddenSequences.add(replacementEvent.sequence);
        }
      }
      continue;
    }

    const targetSequence = parseAssistantSequence(parsed.data.data.targetMessageId);
    if (targetSequence === undefined) {
      throw new SessionHistoryCorruptError();
    }
    const targetDeltaIndex = events.findIndex(
      (candidate) =>
        candidate.sequence === targetSequence && candidate.event.type === "agent.text-delta",
    );
    if (targetDeltaIndex < 0) {
      throw new SessionHistoryCorruptError();
    }
    let originalUserIndex = -1;
    for (let index = targetDeltaIndex - 1; index >= 0; index -= 1) {
      if (events[index]?.event.type === "session.user-message") {
        originalUserIndex = index;
        break;
      }
    }
    if (originalUserIndex < 0) {
      throw new SessionHistoryCorruptError();
    }
    const originalRunEnd = events.findIndex(
      (candidate, candidateIndex) =>
        candidateIndex > originalUserIndex && candidate.event.type === "session.user-message",
    );
    for (
      let index = originalUserIndex + 1;
      index < (originalRunEnd < 0 ? events.length : originalRunEnd);
      index += 1
    ) {
      const event = events[index]?.event.type;
      if (event === "agent.text-delta" || event === "agent.tool-state") {
        hiddenSequences.add(events[index]?.sequence ?? 0);
      }
    }
  }

  return events.filter((event) => !hiddenSequences.has(event.sequence));
}

function isUserMessageId(data: unknown, messageId: string): boolean {
  return isPlainRecord(data) && data.role === "user" && data.messageId === messageId;
}

function parseAssistantSequence(messageId: string): number | undefined {
  const match = /^assistant-(\d+)$/.exec(messageId);
  if (match === null) {
    return undefined;
  }
  const sequence = Number(match[1]);
  return Number.isSafeInteger(sequence) && sequence > 0 ? sequence : undefined;
}

function isLiveAssistantProjectionAlias(messageId: string): boolean {
  return messageIdSchema.safeParse(messageId).success && /:assistant$/.test(messageId);
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
  if (!run.suppressUser) {
    appendHistoryMessage(history, { role: "user", content: run.user.content });
  }

  const retainAssistantText = outcome === "completed";
  for (const unit of run.units) {
    if (unit.kind === "tool" || retainAssistantText) {
      appendHistoryUnit(history, unit);
    }
  }

  // A completed Run cannot end with a Tool Call lacking its Result. Truncation, cancellation,
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

function findAssistantProjectionId(events: readonly PersistedEventRecord[]): string | undefined {
  for (const persisted of events) {
    if (persisted.event.type !== "agent.text-delta") {
      continue;
    }
    const data = asRecord(persisted.event.data);
    if (data === undefined || typeof data.text !== "string" || data.text.length === 0) {
      throw new SessionHistoryCorruptError();
    }
    const messageId = `assistant-${persisted.sequence}`;
    const parsed = messageIdSchema.safeParse(messageId);
    if (!parsed.success) {
      throw new SessionHistoryCorruptError();
    }
    return parsed.data;
  }
  return undefined;
}

function hasCompletedTargetRun(events: readonly PersistedEventRecord[]): boolean {
  let status: SessionStatus | undefined;
  for (const persisted of events) {
    if (persisted.event.type !== "session.status-changed") {
      continue;
    }
    const data = requireExactRecord(persisted.event.data, ["previousStatus", "status"]);
    const parsed = sessionStatusSchema.safeParse(data.status);
    if (!parsed.success) {
      throw new SessionHistoryCorruptError();
    }
    status = parsed.data;
  }
  return status === "completed";
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
  return isPlainRecord(value) ? value : undefined;
}

function toolCallsEqual(left: ToolCall, right: ToolCall): boolean {
  return (
    left.id === right.id && left.name === right.name && jsonValuesEqual(left.input, right.input)
  );
}
