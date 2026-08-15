import type { CheckpointStore } from "@ctrl-zebra/core";
import {
  CorruptEventLogError,
  EventLogLimitExceededError,
  InconsistentSessionRecordError,
  InvalidSessionManifestError,
  SessionNotFoundError,
  type SessionRecord,
  type SessionRepository,
} from "@ctrl-zebra/core";
import {
  assistantMessageSchema,
  hasTokenUsage,
  maxReasoningBlockCodePoints,
  maxReasoningBlocksPerRun,
  maxReasoningBlockUtf8Bytes,
  maxReasoningRunCodePoints,
  maxReasoningRunUtf8Bytes,
  measureReasoningText,
  mergeTokenUsage,
  persistedReasoningEventPayloadSchema,
  type RestoredReasoning,
  type RestoredSession,
  restoredReasoningSchema,
  restoredSessionSchema,
  type SessionSummary,
  type TokenUsage,
  tokenUsageSchema,
  userMessageSchema,
} from "@ctrl-zebra/protocol";
import { isRecord } from "../adapters/record-validation.js";
import {
  EditRelationCorruptError,
  RegenerationRelationCorruptError,
  type ValidatedEditRelation,
  type ValidatedRegenerationRelation,
  validateEditRelations,
  validateRegenerationRelations,
} from "./regeneration-validation.js";

export interface SessionRecoveryActions {
  list(): Promise<readonly SessionSummary[]>;
  restore(sessionId: string): Promise<SessionRestoreProjection>;
  delete?(sessionId: string): Promise<void>;
  clear?(): Promise<number>;
}

export interface SessionRestoreProjection {
  readonly session: RestoredSession;
  readonly reasoning: RestoredReasoning;
}

export type SessionRecoveryErrorCode = "not-found" | "corrupt" | "unavailable";

export class SessionRecoveryError extends Error {
  constructor(readonly code: SessionRecoveryErrorCode) {
    super("The saved Session could not be restored.");
    this.name = "SessionRecoveryError";
  }
}

export type SessionDeletionErrorCode = "not-found" | "partial" | "unavailable";

export class SessionDeletionError extends Error {
  constructor(
    readonly code: SessionDeletionErrorCode,
    readonly deletedCount = 0,
  ) {
    super("The saved Session data could not be fully deleted.");
    this.name = "SessionDeletionError";
  }
}

export function createSessionRecoveryActions(
  selectRepository: () => Promise<SessionRepository>,
  now: () => Date = () => new Date(),
  selectCheckpointStore?: () => Promise<CheckpointStore>,
): SessionRecoveryActions {
  return {
    async list() {
      try {
        const repository = await selectRepository();
        const sessions = await repository.list();
        const normalized: SessionSummary[] = [];
        for (const session of sessions) {
          if (isRecoverableStatus(session.status)) {
            await repository.update(session.sessionId, {
              status: "interrupted",
              updatedAt: now().toISOString(),
            });
            normalized.push({ ...session, status: "interrupted" });
          } else {
            normalized.push(session);
          }
        }
        return normalized.sort(
          (left, right) =>
            right.createdAt.localeCompare(left.createdAt) ||
            left.sessionId.localeCompare(right.sessionId),
        );
      } catch (error) {
        throw toSessionRecoveryError(error);
      }
    },
    async restore(sessionId) {
      let repository: SessionRepository;
      let record: SessionRecord | undefined;
      try {
        repository = await selectRepository();
        record = await repository.get(sessionId);
      } catch (error) {
        throw toSessionRecoveryError(error);
      }
      if (record === undefined) {
        throw new SessionRecoveryError("not-found");
      }
      const status = isRecoverableStatus(record.manifest.status)
        ? "interrupted"
        : record.manifest.status;
      if (status === "interrupted" && record.manifest.status !== "interrupted") {
        try {
          await repository.update(sessionId, {
            status,
            updatedAt: now().toISOString(),
          });
        } catch (error) {
          throw toSessionRecoveryError(error);
        }
      }

      const messages: RestoredSession["messages"][number][] = [];
      let assistant: RestoredSession["messages"][number] | undefined;
      for (const persisted of record.events) {
        if (persisted.event.type === "session.user-message") {
          const result = userMessageSchema.safeParse(persisted.event.data);
          if (!result.success) {
            throw new SessionRecoveryError("corrupt");
          }
          messages.push(result.data);
          assistant = undefined;
        } else if (persisted.event.type === "agent.text-delta") {
          const data = persisted.event.data;
          if (!isRecord(data) || typeof data.text !== "string") {
            throw new SessionRecoveryError("corrupt");
          }
          if (assistant === undefined || assistant.role !== "assistant") {
            assistant = assistantMessageSchema.parse({
              messageId: `assistant-${persisted.sequence}`,
              sessionId,
              createdAt: persisted.recordedAt,
              role: "assistant",
              content: data.text,
            });
            messages.push(assistant);
          } else {
            assistant = assistantMessageSchema.parse({
              ...assistant,
              content: assistant.content + data.text,
            });
            messages[messages.length - 1] = assistant;
          }
        }
      }

      const projectedMessages = applyRegenerationProjection(messages, record);
      return {
        session: restoredSessionSchema.parse({
          sessionId,
          status,
          messages: projectedMessages,
          eventLogTailDamaged: record.eventLogTailDamaged,
          usage: recoverUsage(record),
        }),
        reasoning: recoverReasoning(record),
      };
    },
    async delete(sessionId) {
      let deletedCount = 0;
      let failure: SessionDeletionError | undefined;
      try {
        const repository = await selectRepository();
        if (repository.delete === undefined) {
          throw new SessionDeletionError("unavailable");
        }
        deletedCount += (await repository.delete(sessionId)) ? 1 : 0;
      } catch (error) {
        failure = toSessionDeletionError(error, deletedCount);
      }

      if (selectCheckpointStore === undefined) {
        failure ??= new SessionDeletionError(
          deletedCount > 0 ? "partial" : "unavailable",
          deletedCount,
        );
      } else {
        try {
          const store = await selectCheckpointStore();
          if (store.deleteForSession === undefined) {
            throw new SessionDeletionError(
              deletedCount > 0 ? "partial" : "unavailable",
              deletedCount,
            );
          }
          const report = await store.deleteForSession(sessionId, new AbortController().signal);
          deletedCount += report.deleted;
          if (report.failed > 0 && failure === undefined) {
            failure = new SessionDeletionError("partial", deletedCount);
          }
        } catch (error) {
          failure ??= toSessionDeletionError(error, deletedCount);
        }
      }

      if (failure !== undefined) {
        throw failure;
      }
    },
    async clear() {
      let deletedCount = 0;
      let failure: SessionDeletionError | undefined;
      try {
        const repository = await selectRepository();
        if (repository.clear === undefined) {
          throw new SessionDeletionError("unavailable");
        }
        deletedCount += await repository.clear();
      } catch (error) {
        failure = toSessionDeletionError(error, deletedCount);
      }

      if (selectCheckpointStore === undefined) {
        failure ??= new SessionDeletionError(
          deletedCount > 0 ? "partial" : "unavailable",
          deletedCount,
        );
      } else {
        try {
          const store = await selectCheckpointStore();
          if (store.clear === undefined) {
            throw new SessionDeletionError(
              deletedCount > 0 ? "partial" : "unavailable",
              deletedCount,
            );
          }
          const report = await store.clear(new AbortController().signal);
          if (report.failed > 0 && failure === undefined) {
            failure = new SessionDeletionError("partial", deletedCount);
          }
        } catch (error) {
          failure ??= toSessionDeletionError(error, deletedCount);
        }
      }

      if (failure !== undefined) {
        throw failure;
      }
      return deletedCount;
    },
  };
}

function applyRegenerationProjection(
  messages: readonly RestoredSession["messages"][number][],
  record: SessionRecord,
): readonly RestoredSession["messages"][number][] {
  const replacedMessageIds = new Set<string>();
  const suppressedMessageIds = new Set<string>();
  let relations: readonly ValidatedRegenerationRelation[];
  try {
    relations = validateRegenerationRelations(record.events, record.manifest.sessionId);
  } catch (error) {
    if (error instanceof RegenerationRelationCorruptError) {
      throw new SessionRecoveryError("corrupt");
    }
    throw error;
  }

  let editRelations: readonly ValidatedEditRelation[];
  try {
    editRelations = validateEditRelations(record.events, record.manifest.sessionId);
  } catch (error) {
    if (
      error instanceof EditRelationCorruptError ||
      error instanceof RegenerationRelationCorruptError
    ) {
      throw new SessionRecoveryError("corrupt");
    }
    throw error;
  }

  for (const relation of relations) {
    if (
      !messages.some((message) => message.messageId === relation.targetMessageId) ||
      suppressedMessageIds.has(relation.replacementUserMessageId)
    ) {
      throw new SessionRecoveryError("corrupt");
    }
    suppressedMessageIds.add(relation.replacementUserMessageId);
    if (relation.replacementCompleted) {
      replacedMessageIds.add(relation.targetMessageId);
    } else if (relation.replacementFirstTextIndex !== undefined) {
      suppressedMessageIds.add(
        `assistant-${record.events[relation.replacementFirstTextIndex]?.sequence}`,
      );
    }
  }

  const editedUserContents = new Map<string, string>();
  for (const relation of editRelations) {
    if (
      !messages.some((message) => message.messageId === relation.targetMessageId) ||
      suppressedMessageIds.has(relation.replacementUserMessageId)
    ) {
      throw new SessionRecoveryError("corrupt");
    }
    suppressedMessageIds.add(relation.replacementUserMessageId);
    if (!relation.replacementCompleted) {
      if (relation.replacementFirstTextIndex !== undefined) {
        suppressedMessageIds.add(
          `assistant-${record.events[relation.replacementFirstTextIndex]?.sequence}`,
        );
      }
      continue;
    }

    editedUserContents.set(relation.targetMessageId, relation.replacementContent);
    for (const persisted of record.events.slice(
      relation.targetUserIndex + 1,
      relation.replacementUserIndex,
    )) {
      if (persisted.event.type === "session.user-message") {
        const user = userMessageSchema.safeParse(persisted.event.data);
        if (!user.success || user.data.sessionId !== record.manifest.sessionId) {
          throw new SessionRecoveryError("corrupt");
        }
        suppressedMessageIds.add(user.data.messageId);
      }
      if (persisted.event.type === "agent.text-delta") {
        suppressedMessageIds.add(`assistant-${persisted.sequence}`);
      }
    }
  }

  return messages
    .filter(
      (message) =>
        !replacedMessageIds.has(message.messageId) && !suppressedMessageIds.has(message.messageId),
    )
    .map((message) => {
      const replacement = editedUserContents.get(message.messageId);
      return replacement === undefined ? message : { ...message, content: replacement };
    });
}

function recoverUsage(record: SessionRecord): TokenUsage | undefined {
  let usage: TokenUsage | undefined;

  for (const persisted of record.events) {
    if (persisted.event.type !== "session.usage") {
      continue;
    }
    const parsed = tokenUsageSchema.safeParse(persisted.event.data);
    if (!parsed.success) {
      throw new SessionRecoveryError("corrupt");
    }
    const merged = mergeTokenUsage(usage, parsed.data);
    if (!merged.ok) {
      throw new SessionRecoveryError("corrupt");
    }
    usage = merged.usage;
  }

  return usage === undefined || !hasTokenUsage(usage) ? undefined : usage;
}

interface RecoveredBlock {
  readonly blockId: string;
  readonly startSequence: number;
  readonly parts: string[];
  codePoints: number;
  utf8Bytes: number;
  blockLimited: boolean;
}

function recoverReasoning(record: SessionRecord): RestoredReasoning {
  const blocks: RestoredReasoning["blocks"][number][] = [];
  const seenBlockIds = new Set<string>();
  let open: RecoveredBlock | undefined;
  let acceptedBlocks = 0;
  let runCodePoints = 0;
  let runUtf8Bytes = 0;
  let runTruncated = false;
  let runTextLimitSeen = false;
  let blockCountLimitSeen = false;

  for (const persisted of record.events) {
    if (!isRecognizedReasoningEventType(persisted.event.type)) {
      continue;
    }
    const parsed = persistedReasoningEventPayloadSchema.safeParse(persisted.event);
    if (!parsed.success) {
      throw new SessionRecoveryError("corrupt");
    }
    const event = parsed.data;
    if (blockCountLimitSeen) {
      throw new SessionRecoveryError("corrupt");
    }

    if (event.type === "session.reasoning-start") {
      if (
        open !== undefined ||
        seenBlockIds.has(event.data.blockId) ||
        acceptedBlocks >= maxReasoningBlocksPerRun
      ) {
        throw new SessionRecoveryError("corrupt");
      }
      acceptedBlocks += 1;
      seenBlockIds.add(event.data.blockId);
      open = {
        blockId: event.data.blockId,
        startSequence: persisted.sequence,
        parts: [],
        codePoints: 0,
        utf8Bytes: 0,
        blockLimited: false,
      };
      continue;
    }

    if (event.type === "session.reasoning-delta") {
      if (
        open === undefined ||
        open.blockId !== event.data.blockId ||
        open.blockLimited ||
        runTextLimitSeen
      ) {
        throw new SessionRecoveryError("corrupt");
      }
      const measurement = measureReasoningText(event.data.text);
      if (measurement === undefined) {
        throw new SessionRecoveryError("corrupt");
      }
      open.codePoints += measurement.codePoints;
      open.utf8Bytes += measurement.utf8Bytes;
      runCodePoints += measurement.codePoints;
      runUtf8Bytes += measurement.utf8Bytes;
      if (
        open.codePoints > maxReasoningBlockCodePoints ||
        open.utf8Bytes > maxReasoningBlockUtf8Bytes ||
        runCodePoints > maxReasoningRunCodePoints ||
        runUtf8Bytes > maxReasoningRunUtf8Bytes
      ) {
        throw new SessionRecoveryError("corrupt");
      }
      open.parts.push(event.data.text);
      continue;
    }

    if (event.type === "session.reasoning-limit") {
      if (event.data.scope === "block") {
        if (
          open === undefined ||
          open.blockId !== event.data.blockId ||
          open.blockLimited ||
          runTextLimitSeen ||
          !isLimitReached(
            event.data.reason,
            open.codePoints,
            open.utf8Bytes,
            maxReasoningBlockCodePoints,
            maxReasoningBlockUtf8Bytes,
          )
        ) {
          throw new SessionRecoveryError("corrupt");
        }
        open.blockLimited = true;
      } else if (event.data.reason === "block-count") {
        if (
          open !== undefined ||
          blockCountLimitSeen ||
          acceptedBlocks !== maxReasoningBlocksPerRun
        ) {
          throw new SessionRecoveryError("corrupt");
        }
        blockCountLimitSeen = true;
        runTruncated = true;
      } else {
        if (
          open === undefined ||
          runTextLimitSeen ||
          !isLimitReached(
            event.data.reason,
            runCodePoints,
            runUtf8Bytes,
            maxReasoningRunCodePoints,
            maxReasoningRunUtf8Bytes,
          )
        ) {
          throw new SessionRecoveryError("corrupt");
        }
        runTextLimitSeen = true;
        runTruncated = true;
      }
      continue;
    }

    if (open === undefined || open.blockId !== event.data.blockId) {
      throw new SessionRecoveryError("corrupt");
    }
    if (open.blockLimited && !event.data.truncated) {
      throw new SessionRecoveryError("corrupt");
    }
    if (!open.blockLimited && !runTextLimitSeen && event.data.truncated) {
      throw new SessionRecoveryError("corrupt");
    }
    const content = open.parts.join("");
    if (content.length > 0) {
      blocks.push({
        blockId: open.blockId,
        startSequence: open.startSequence,
        endSequence: persisted.sequence,
        content,
        state: "complete",
        truncated: event.data.truncated,
      });
    }
    open = undefined;
  }

  if (open !== undefined) {
    const content = open.parts.join("");
    if (content.length > 0) {
      blocks.push({
        blockId: open.blockId,
        startSequence: open.startSequence,
        content,
        state: "partial",
        truncated: open.blockLimited || runTextLimitSeen,
      });
    }
  }

  return restoredReasoningSchema.parse({
    sessionId: record.manifest.sessionId,
    blocks,
    runTruncated,
  });
}

function isRecognizedReasoningEventType(type: string): boolean {
  return (
    type === "session.reasoning-start" ||
    type === "session.reasoning-delta" ||
    type === "session.reasoning-end" ||
    type === "session.reasoning-limit"
  );
}

function isLimitReached(
  reason: "code-points" | "utf8-bytes",
  codePoints: number,
  utf8Bytes: number,
  maxCodePoints: number,
  maxUtf8Bytes: number,
): boolean {
  return reason === "utf8-bytes"
    ? utf8Bytes === maxUtf8Bytes
    : codePoints === maxCodePoints && utf8Bytes < maxUtf8Bytes;
}

function isRecoverableStatus(status: SessionSummary["status"]): boolean {
  return (
    status === "idle" ||
    status === "preparing" ||
    status === "streaming" ||
    status === "awaiting_approval" ||
    status === "executing_tool"
  );
}

function toSessionRecoveryError(error: unknown): SessionRecoveryError {
  if (error instanceof SessionRecoveryError) {
    return error;
  }
  if (error instanceof SessionNotFoundError) {
    return new SessionRecoveryError("not-found");
  }
  if (
    error instanceof InvalidSessionManifestError ||
    error instanceof CorruptEventLogError ||
    error instanceof EventLogLimitExceededError ||
    error instanceof InconsistentSessionRecordError
  ) {
    return new SessionRecoveryError("corrupt");
  }
  return new SessionRecoveryError("unavailable");
}

function toSessionDeletionError(error: unknown, deletedCount: number): SessionDeletionError {
  if (error instanceof SessionDeletionError) {
    return error;
  }
  return new SessionDeletionError(deletedCount > 0 ? "partial" : "unavailable", deletedCount);
}
