import type { SessionStatus } from "@ctrl-zebra/protocol";

import type { CheckpointStore } from "./checkpoint-store.js";
import { maxSessionRecords, type SessionRepository } from "./session-repository.js";

interface SessionRetentionCandidate {
  readonly sessionId: string;
  readonly status: SessionStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface RetentionCandidateSource {
  listRetentionCandidates(): Promise<readonly SessionRetentionCandidate[]>;
}

interface BatchCheckpointStore {
  deleteForSessions(
    sessionIds: readonly unknown[],
    signal: AbortSignal,
  ): Promise<{ readonly deleted: number; readonly failed: number }>;
}

export const defaultSessionRetentionDays = 30;
export const minSessionRetentionDays = 1;
export const maxSessionRetentionDays = 3_650;

const millisecondsPerDay = 86_400_000;
const protectedSessionStatuses = new Set<SessionStatus>([
  "idle",
  "preparing",
  "streaming",
  "awaiting_approval",
  "executing_tool",
]);

export interface SessionRetentionPolicy {
  readonly enabled: boolean;
  readonly days: number;
}

export interface SessionRetentionCleanupOptions {
  readonly policy: SessionRetentionPolicy;
  readonly now: () => Date;
  readonly signal: AbortSignal;
  readonly candidates?: readonly SessionRetentionCandidate[];
}

export interface SessionRetentionCleanupReport {
  readonly outcome: "disabled" | "completed";
  readonly cutoffAt?: string;
  readonly scanned: number;
  readonly expired: number;
  readonly protected: number;
  readonly deletedSessions: number;
  readonly deletedCheckpoints: number;
  readonly failedSessions: number;
  readonly failedCheckpoints: number;
  /** IDs are used only to remove stale list entries in the current Host projection. */
  readonly removedSessionIds: readonly string[];
}

export class InvalidSessionRetentionPolicyError extends Error {
  constructor() {
    super("The Session retention policy is invalid.");
    this.name = "InvalidSessionRetentionPolicyError";
  }
}

/**
 * Removes expired Sessions and their owned Checkpoints using a bounded manifest metadata scan. The
 * caller supplies the clock so the date boundary is deterministic and independent of local time.
 */
export async function cleanupExpiredSessions(
  repository: SessionRepository,
  checkpointStore: CheckpointStore | undefined,
  options: SessionRetentionCleanupOptions,
): Promise<SessionRetentionCleanupReport> {
  options.signal.throwIfAborted();
  validatePolicy(options.policy);
  if (!options.policy.enabled) {
    return {
      outcome: "disabled",
      scanned: 0,
      expired: 0,
      protected: 0,
      deletedSessions: 0,
      deletedCheckpoints: 0,
      failedSessions: 0,
      failedCheckpoints: 0,
      removedSessionIds: [],
    };
  }

  const now = options.now();
  const nowMilliseconds = now.getTime();
  if (!Number.isFinite(nowMilliseconds)) {
    throw new InvalidSessionRetentionPolicyError();
  }
  const cutoffMilliseconds = nowMilliseconds - options.policy.days * millisecondsPerDay;
  const cutoffAt = new Date(cutoffMilliseconds).toISOString();
  const candidateSource = repository as SessionRepository & Partial<RetentionCandidateSource>;
  const candidates =
    options.candidates ??
    (candidateSource.listRetentionCandidates === undefined
      ? (await repository.list()).map(toLegacyCandidate)
      : await candidateSource.listRetentionCandidates());
  options.signal.throwIfAborted();
  if (candidates.length > maxSessionRecords) {
    throw new RangeError(`Persisted Session count exceeds the ${maxSessionRecords}-Session limit.`);
  }

  let expired = 0;
  let protectedCount = 0;
  let deletedSessions = 0;
  let failedSessions = 0;
  const removedSessionIds: string[] = [];
  const checkpointOwners: string[] = [];

  for (const candidate of candidates) {
    options.signal.throwIfAborted();
    if (protectedSessionStatuses.has(candidate.status)) {
      protectedCount += 1;
      continue;
    }
    const updatedAtMilliseconds = Date.parse(candidate.updatedAt);
    if (!Number.isFinite(updatedAtMilliseconds) || updatedAtMilliseconds > cutoffMilliseconds) {
      continue;
    }
    expired += 1;

    if (repository.delete === undefined) {
      failedSessions += 1;
      continue;
    }

    let deleted: boolean;
    try {
      deleted = await repository.delete(candidate.sessionId);
      options.signal.throwIfAborted();
    } catch {
      options.signal.throwIfAborted();
      failedSessions += 1;
      continue;
    }

    if (!deleted) {
      failedSessions += 1;
      continue;
    }
    deletedSessions += 1;
    removedSessionIds.push(candidate.sessionId);
    checkpointOwners.push(candidate.sessionId);
  }

  let deletedCheckpoints = 0;
  let failedCheckpoints = 0;
  if (checkpointOwners.length > 0) {
    const batchCheckpointStore = checkpointStore as
      | (CheckpointStore & Partial<BatchCheckpointStore>)
      | undefined;
    if (batchCheckpointStore?.deleteForSessions !== undefined) {
      try {
        const report = await batchCheckpointStore.deleteForSessions(
          checkpointOwners,
          options.signal,
        );
        deletedCheckpoints += report.deleted;
        failedCheckpoints += report.failed;
      } catch {
        options.signal.throwIfAborted();
        failedCheckpoints += checkpointOwners.length;
      }
    } else if (checkpointStore?.deleteForSession !== undefined) {
      for (const sessionId of checkpointOwners) {
        options.signal.throwIfAborted();
        try {
          const report = await checkpointStore.deleteForSession(sessionId, options.signal);
          deletedCheckpoints += report.deleted;
          failedCheckpoints += report.failed;
        } catch {
          options.signal.throwIfAborted();
          failedCheckpoints += 1;
        }
      }
    } else {
      failedCheckpoints += checkpointOwners.length;
    }
  }

  return {
    outcome: "completed",
    cutoffAt,
    scanned: candidates.length,
    expired,
    protected: protectedCount,
    deletedSessions,
    deletedCheckpoints,
    failedSessions,
    failedCheckpoints,
    removedSessionIds,
  };
}

function validatePolicy(policy: SessionRetentionPolicy): void {
  if (
    typeof policy.enabled !== "boolean" ||
    !Number.isSafeInteger(policy.days) ||
    policy.days < minSessionRetentionDays ||
    policy.days > maxSessionRetentionDays
  ) {
    throw new InvalidSessionRetentionPolicyError();
  }
}

function toLegacyCandidate(summary: {
  readonly sessionId: string;
  readonly status: SessionStatus;
  readonly createdAt: string;
}): SessionRetentionCandidate {
  return { ...summary, updatedAt: summary.createdAt };
}
