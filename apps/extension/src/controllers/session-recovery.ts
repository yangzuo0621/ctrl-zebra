import type { SessionRecord, SessionRepository } from "@ctrl-zebra/core";
import {
  assistantMessageSchema,
  type JsonValue,
  type RestoredSession,
  restoredSessionSchema,
  type SessionSummary,
  userMessageSchema,
} from "@ctrl-zebra/protocol";

export interface SessionRecoveryActions {
  list(): Promise<readonly SessionSummary[]>;
  restore(sessionId: string): Promise<RestoredSession>;
}

export type SessionRecoveryErrorCode = "not-found" | "corrupt" | "unavailable";

export class SessionRecoveryError extends Error {
  constructor(readonly code: SessionRecoveryErrorCode) {
    super("The saved Session could not be restored.");
    this.name = "SessionRecoveryError";
  }
}

export function createSessionRecoveryActions(
  selectRepository: () => Promise<SessionRepository>,
  now: () => Date = () => new Date(),
): SessionRecoveryActions {
  return {
    async list() {
      const repository = await selectRepository();
      const sessions = await repository.list();
      const normalized: SessionSummary[] = [];
      for (const session of sessions) {
        if (isRecoverableStatus(session.status)) {
          try {
            await repository.update(session.sessionId, {
              status: "interrupted",
              updatedAt: now().toISOString(),
            });
            normalized.push({ ...session, status: "interrupted" });
          } catch {}
        } else {
          normalized.push(session);
        }
      }
      return normalized.sort(
        (left, right) =>
          right.createdAt.localeCompare(left.createdAt) ||
          left.sessionId.localeCompare(right.sessionId),
      );
    },
    async restore(sessionId) {
      let repository: SessionRepository;
      let record: SessionRecord | undefined;
      try {
        repository = await selectRepository();
        record = await repository.get(sessionId);
      } catch {
        throw new SessionRecoveryError("corrupt");
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
        } catch {
          throw new SessionRecoveryError("corrupt");
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
          if (!isJsonObject(data) || typeof data.text !== "string") {
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

      return restoredSessionSchema.parse({
        sessionId,
        status,
        messages,
        eventLogTailDamaged: record.eventLogTailDamaged,
      });
    },
  };
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

function isJsonObject(value: JsonValue): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
