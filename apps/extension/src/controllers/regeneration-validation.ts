import {
  messageIdSchema,
  type PersistedEventRecord,
  persistedRegenerationEventPayloadSchema,
  type SessionStatus,
  sessionStatusSchema,
  userMessageSchema,
} from "@ctrl-zebra/protocol";
import { isRecord } from "../adapters/record-validation.js";

export class RegenerationRelationCorruptError extends Error {
  constructor() {
    super("The saved regeneration relation is corrupt.");
    this.name = "RegenerationRelationCorruptError";
  }
}

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

export interface ValidatedRegenerationRelation {
  readonly relationIndex: number;
  readonly targetMessageId: string;
  readonly replacementUserMessageId: string;
  readonly targetUserIndex: number;
  readonly targetFirstTextIndex: number;
  readonly replacementUserIndex: number;
  readonly replacementRunStartIndex: number;
  readonly replacementRunEndIndex: number;
  readonly replacementFirstTextIndex?: number;
  readonly replacementCompleted: boolean;
}

/**
 * Owns the ordering, Session ownership, and target projection rules for regeneration relations.
 * Both model-history continuation and Session recovery consume this exact validated relation set.
 */
export function validateRegenerationRelations(
  events: readonly PersistedEventRecord[],
  sessionId: string,
): readonly ValidatedRegenerationRelation[] {
  const users = events.flatMap((persisted, index) => {
    if (persisted.event.type !== "session.user-message") {
      return [];
    }
    const parsed = userMessageSchema.safeParse(persisted.event.data);
    if (!parsed.success || parsed.data.sessionId !== sessionId) {
      throw new RegenerationRelationCorruptError();
    }
    return [{ index, messageId: parsed.data.messageId }];
  });
  const seenTargets = new Set<string>();
  const seenReplacementUsers = new Set<string>();
  const relations: ValidatedRegenerationRelation[] = [];

  for (let relationIndex = 0; relationIndex < events.length; relationIndex += 1) {
    const relation = events[relationIndex];
    if (relation?.event.type !== "session.regeneration") {
      continue;
    }
    const parsed = persistedRegenerationEventPayloadSchema.safeParse(relation.event);
    if (!parsed.success) {
      throw new RegenerationRelationCorruptError();
    }
    const { targetMessageId, replacementUserMessageId } = parsed.data.data;
    if (seenTargets.has(targetMessageId) || seenReplacementUsers.has(replacementUserMessageId)) {
      throw new RegenerationRelationCorruptError();
    }
    seenTargets.add(targetMessageId);
    seenReplacementUsers.add(replacementUserMessageId);

    const replacementUsers = users.filter(
      ({ messageId }) => messageId === replacementUserMessageId,
    );
    if (replacementUsers.length !== 1) {
      throw new RegenerationRelationCorruptError();
    }
    const replacementUserIndex = replacementUsers[0]?.index;
    if (replacementUserIndex === undefined || replacementUserIndex >= relationIndex) {
      throw new RegenerationRelationCorruptError();
    }

    // The relation follows the new user event and any explicitly attached MCP context, but must
    // precede every event owned by the replacement Run. This fences relations moved before/after
    // the Run from being interpreted differently by recovery and continuation.
    for (let index = replacementUserIndex + 1; index < relationIndex; index += 1) {
      const eventType = events[index]?.event.type;
      if (
        eventType !== "session.mcp-resource-attached" &&
        eventType !== "session.mcp-prompt-confirmed"
      ) {
        throw new RegenerationRelationCorruptError();
      }
    }

    let targetUserIndex = -1;
    for (const user of users) {
      if (user.index < replacementUserIndex && user.index > targetUserIndex) {
        targetUserIndex = user.index;
      }
    }
    if (targetUserIndex < 0) {
      throw new RegenerationRelationCorruptError();
    }
    const targetRunEvents = events.slice(targetUserIndex + 1, replacementUserIndex);
    const targetFirstTextIndex = findFirstTextDeltaIndex(targetRunEvents, targetUserIndex + 1);
    if (targetFirstTextIndex === undefined) {
      throw new RegenerationRelationCorruptError();
    }
    const canonicalTargetMessageId = assistantProjectionId(events[targetFirstTextIndex]?.sequence);
    if (canonicalTargetMessageId !== targetMessageId || !isCompletedRun(targetRunEvents)) {
      throw new RegenerationRelationCorruptError();
    }

    const replacementRunStartIndex = relationIndex + 1;
    const replacementRunEndIndex =
      users.find(({ index }) => index > replacementUserIndex)?.index ?? events.length;
    const replacementRunEvents = events.slice(replacementRunStartIndex, replacementRunEndIndex);
    const replacementFirstTextIndex = findFirstTextDeltaIndex(
      replacementRunEvents,
      replacementRunStartIndex,
    );
    relations.push({
      relationIndex,
      targetMessageId,
      replacementUserMessageId,
      targetUserIndex,
      targetFirstTextIndex,
      replacementUserIndex,
      replacementRunStartIndex,
      replacementRunEndIndex,
      ...(replacementFirstTextIndex === undefined ? {} : { replacementFirstTextIndex }),
      replacementCompleted: isCompletedRun(replacementRunEvents),
    });
  }

  return relations;
}

export function canonicalAssistantProjectionId(
  events: readonly PersistedEventRecord[],
): string | undefined {
  const firstTextIndex = findFirstTextDeltaIndex(events, 0);
  return firstTextIndex === undefined
    ? undefined
    : assistantProjectionId(events[firstTextIndex]?.sequence);
}

export function isCompletedRegenerationRun(events: readonly PersistedEventRecord[]): boolean {
  return isCompletedRun(events);
}

function findFirstTextDeltaIndex(
  events: readonly PersistedEventRecord[],
  offset: number,
): number | undefined {
  for (let index = 0; index < events.length; index += 1) {
    const persisted = events[index];
    if (persisted?.event.type !== "agent.text-delta") {
      continue;
    }
    const data = persisted.event.data;
    if (!isRecord(data) || typeof data.text !== "string" || data.text.length === 0) {
      throw new RegenerationRelationCorruptError();
    }
    return offset + index;
  }
  return undefined;
}

function assistantProjectionId(sequence: number | undefined): string | undefined {
  if (sequence === undefined) {
    throw new RegenerationRelationCorruptError();
  }
  const parsed = messageIdSchema.safeParse(`assistant-${sequence}`);
  if (!parsed.success) {
    throw new RegenerationRelationCorruptError();
  }
  return parsed.data;
}

function isCompletedRun(events: readonly PersistedEventRecord[]): boolean {
  let currentStatus: string | undefined;
  let terminal = false;
  let sawStatus = false;
  for (const persisted of events) {
    if (terminal && isRunOwnedEvent(persisted.event.type)) {
      throw new RegenerationRelationCorruptError();
    }
    if (persisted.event.type !== "session.status-changed") {
      continue;
    }
    if (terminal) {
      throw new RegenerationRelationCorruptError();
    }
    const data = persisted.event.data;
    if (
      !isRecord(data) ||
      typeof data.previousStatus !== "string" ||
      typeof data.status !== "string"
    ) {
      throw new RegenerationRelationCorruptError();
    }
    const previousStatus = sessionStatusSchema.safeParse(data.previousStatus);
    const status = sessionStatusSchema.safeParse(data.status);
    if (!previousStatus.success || !status.success) {
      throw new RegenerationRelationCorruptError();
    }
    if (currentStatus !== undefined && currentStatus !== previousStatus.data) {
      throw new RegenerationRelationCorruptError();
    }
    if (!legalTransitions[previousStatus.data].includes(status.data)) {
      throw new RegenerationRelationCorruptError();
    }
    currentStatus = status.data;
    sawStatus = true;
    if (
      currentStatus === "completed" ||
      currentStatus === "truncated" ||
      currentStatus === "cancelled" ||
      currentStatus === "failed" ||
      currentStatus === "interrupted"
    ) {
      terminal = true;
    }
  }
  return sawStatus && currentStatus === "completed";
}

function isRunOwnedEvent(type: string): boolean {
  return (
    type === "session.status-changed" ||
    type === "session.usage" ||
    type === "session.reasoning-start" ||
    type === "session.reasoning-delta" ||
    type === "session.reasoning-end" ||
    type === "session.reasoning-limit" ||
    type === "session.mcp-tool-call" ||
    type === "session.mcp-tool-result" ||
    type === "agent.text-delta" ||
    type === "agent.tool-state"
  );
}
