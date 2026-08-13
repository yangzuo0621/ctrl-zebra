import type { FileCreatePlan } from "@ctrl-zebra/core";
import type { Checkpoint, CheckpointRunId, SessionId } from "@ctrl-zebra/protocol";

export interface FileCreateOwnership {
  readonly sessionId: SessionId;
  readonly runId: CheckpointRunId;
}

export interface FileCreateResource {
  toString(): string;
}

export interface FileCreateTarget<Resource extends FileCreateResource> {
  readonly resource: Resource;
  readonly exists: boolean;
}

export interface FileCreateApplierDependencies<Resource extends FileCreateResource, Edit> {
  readonly resolveTarget: (uri: string, signal: AbortSignal) => Promise<FileCreateTarget<Resource>>;
  readonly createWorkspaceEdit: () => Edit;
  readonly createFile: (edit: Edit, uri: Resource) => void;
  readonly insert: (edit: Edit, uri: Resource, text: string) => void;
  readonly assertCanApply: () => void;
  readonly applyWorkspaceEdit: (edit: Edit) => Promise<boolean>;
  readonly createCheckpoint: (checkpoint: Checkpoint, signal: AbortSignal) => Promise<void>;
  readonly createId: () => string;
  readonly now: () => Date;
}

export class FileCreateConflictError extends Error {
  constructor() {
    super("The target file appeared before the approved creation could be applied.");
    this.name = "FileCreateConflictError";
  }
}

export class FileCreateApplyError extends Error {
  constructor() {
    super("The host could not apply the approved file creation.");
    this.name = "FileCreateApplyError";
  }
}

export class FileCreateApplier<Resource extends FileCreateResource, Edit> {
  readonly #dependencies: FileCreateApplierDependencies<Resource, Edit>;

  constructor(dependencies: FileCreateApplierDependencies<Resource, Edit>) {
    this.#dependencies = dependencies;
  }

  async apply(
    plan: FileCreatePlan,
    ownership: FileCreateOwnership,
    signal: AbortSignal,
  ): Promise<void> {
    signal.throwIfAborted();
    const current = await this.#dependencies.resolveTarget(plan.uri, signal);
    signal.throwIfAborted();
    if (current.exists || current.resource.toString() !== plan.uri) {
      throw new FileCreateConflictError();
    }

    await this.#dependencies.createCheckpoint(
      {
        id: this.#dependencies.createId(),
        sessionId: ownership.sessionId,
        runId: ownership.runId,
        createdAt: this.#dependencies.now().toISOString(),
        files: [
          {
            uri: plan.uri,
            before: { kind: "absent" },
            after: { kind: "text", afterHash: plan.afterHash },
          },
        ],
      },
      signal,
    );
    signal.throwIfAborted();

    const edit = this.#dependencies.createWorkspaceEdit();
    const target = await this.#dependencies.resolveTarget(plan.uri, signal);
    signal.throwIfAborted();
    if (target.exists || target.resource.toString() !== plan.uri) {
      throw new FileCreateConflictError();
    }
    this.#dependencies.createFile(edit, target.resource);
    this.#dependencies.insert(edit, target.resource, plan.content);

    // VS Code exposes no cancellation input after this atomic text-only operation is submitted.
    this.#dependencies.assertCanApply();
    const applied = await this.#dependencies.applyWorkspaceEdit(edit);
    if (!applied) {
      throw new FileCreateApplyError();
    }
  }
}
