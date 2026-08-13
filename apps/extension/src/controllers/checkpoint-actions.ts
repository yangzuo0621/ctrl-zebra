import type { CheckpointStore } from "@ctrl-zebra/core";
import type { CheckpointSummary } from "@ctrl-zebra/protocol";

import {
  CheckpointNotFoundError,
  CheckpointRestoreConflictError,
} from "../adapters/checkpoint-restorer.js";

export type CheckpointActionErrorCode = "not-found" | "conflict" | "unavailable";

export class CheckpointActionError extends Error {
  constructor(readonly code: CheckpointActionErrorCode) {
    super("The Checkpoint operation could not be completed.");
    this.name = "CheckpointActionError";
  }
}

export interface CheckpointActions {
  list(signal: AbortSignal): Promise<readonly CheckpointSummary[]>;
  restore(checkpointId: string, signal: AbortSignal): Promise<void>;
}

interface CheckpointActionsDependencies {
  readonly selectStore: () => Promise<CheckpointStore>;
  readonly restore: (
    store: CheckpointStore,
    checkpointId: string,
    signal: AbortSignal,
  ) => Promise<void>;
}

export function createCheckpointActions(
  dependencies: CheckpointActionsDependencies,
): CheckpointActions {
  return {
    async list(signal) {
      try {
        const store = await dependencies.selectStore();
        signal.throwIfAborted();
        const checkpoints = await store.list(signal);
        return checkpoints.map(({ id, sessionId, runId, createdAt, files }) => ({
          id,
          sessionId,
          runId,
          createdAt,
          files: files.map((file) => {
            if (
              file.beforeContent !== undefined &&
              file.beforeHash !== undefined &&
              file.afterHash !== undefined
            ) {
              return { uri: file.uri, beforeHash: file.beforeHash, afterHash: file.afterHash };
            }
            const before = file.before;
            const after = file.after;
            if (before === undefined || after === undefined) {
              throw new Error("Invalid Checkpoint state.");
            }
            return {
              uri: file.uri,
              before:
                before.kind === "absent"
                  ? { kind: "absent" as const }
                  : { kind: "text" as const, beforeHash: before.beforeHash },
              after:
                after.kind === "absent"
                  ? { kind: "absent" as const }
                  : { kind: "text" as const, afterHash: after.afterHash },
            };
          }),
        }));
      } catch {
        signal.throwIfAborted();
        throw new CheckpointActionError("unavailable");
      }
    },
    async restore(checkpointId, signal) {
      try {
        const store = await dependencies.selectStore();
        signal.throwIfAborted();
        await dependencies.restore(store, checkpointId, signal);
      } catch (error) {
        signal.throwIfAborted();
        if (error instanceof CheckpointNotFoundError) {
          throw new CheckpointActionError("not-found");
        }
        if (error instanceof CheckpointRestoreConflictError) {
          throw new CheckpointActionError("conflict");
        }
        throw new CheckpointActionError("unavailable");
      }
    },
  };
}
