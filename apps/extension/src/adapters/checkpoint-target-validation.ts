import type { Uri } from "vscode";

import type { WorkspaceScope } from "./workspace-scope.js";

export type CheckpointTargetScope = Pick<WorkspaceScope, "validate" | "validateNewFile">;
export type CheckpointTargetStat = (target: Uri) => Thenable<unknown> | PromiseLike<unknown>;
export type CheckpointTargetNotFound = (error: unknown) => boolean;

/**
 * Validate the persisted URI lexically and through the selected workspace before probing the
 * host. This ordering prevents an out-of-scope URI from triggering a remote or local stat.
 */
export async function validateCheckpointTarget(
  scope: CheckpointTargetScope,
  requested: Uri,
  signal: AbortSignal,
  stat: CheckpointTargetStat,
  isNotFound: CheckpointTargetNotFound,
): Promise<Uri> {
  const candidate = await scope.validateNewFile(requested, signal);
  signal.throwIfAborted();
  try {
    await stat(candidate);
    signal.throwIfAborted();
    return scope.validate(requested, signal);
  } catch (error) {
    signal.throwIfAborted();
    if (!isNotFound(error)) {
      throw error;
    }
    return candidate;
  }
}
