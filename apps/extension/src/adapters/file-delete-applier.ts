import type { FileDeletePlan } from "@ctrl-zebra/core";
import type { Checkpoint, CheckpointRunId, SessionId } from "@ctrl-zebra/protocol";

export interface FileDeleteOwnership {
  readonly sessionId: SessionId;
  readonly runId: CheckpointRunId;
}

export interface FileDeleteResource {
  toString(): string;
}

export interface FileDeleteTarget<Resource extends FileDeleteResource> {
  readonly resource: Resource;
  readonly exists: boolean;
  readonly text?: string;
}

export interface FileDeleteApplierDependencies<Resource extends FileDeleteResource, Edit> {
  readonly resolveTarget: (uri: string, signal: AbortSignal) => Promise<FileDeleteTarget<Resource>>;
  readonly createWorkspaceEdit: () => Edit;
  readonly deleteFile: (edit: Edit, uri: Resource) => void;
  readonly assertCanApply: () => void;
  readonly applyWorkspaceEdit: (edit: Edit) => Promise<boolean>;
  readonly hashText: (text: string) => string;
  readonly createCheckpoint: (checkpoint: Checkpoint, signal: AbortSignal) => Promise<void>;
  readonly createId: () => string;
  readonly now: () => Date;
}

export class FileDeleteConflictError extends Error {
  constructor() {
    super("The target file changed before the approved deletion could be applied.");
    this.name = "FileDeleteConflictError";
  }
}

export class FileDeleteApplyError extends Error {
  constructor() {
    super("The host could not apply the approved file deletion.");
    this.name = "FileDeleteApplyError";
  }
}

export class FileDeleteApplier<Resource extends FileDeleteResource, Edit> {
  readonly #dependencies: FileDeleteApplierDependencies<Resource, Edit>;

  constructor(dependencies: FileDeleteApplierDependencies<Resource, Edit>) {
    this.#dependencies = dependencies;
  }

  async apply(
    plan: FileDeletePlan,
    ownership: FileDeleteOwnership,
    signal: AbortSignal,
  ): Promise<void> {
    signal.throwIfAborted();
    const current = await this.#dependencies.resolveTarget(plan.uri, signal);
    signal.throwIfAborted();
    this.#assertCurrent(plan, current);

    await this.#dependencies.createCheckpoint(
      {
        id: this.#dependencies.createId(),
        sessionId: ownership.sessionId,
        runId: ownership.runId,
        createdAt: this.#dependencies.now().toISOString(),
        files: [
          {
            uri: plan.uri,
            before: {
              kind: "text",
              content: plan.beforeContent,
              beforeHash: plan.beforeHash,
            },
            after: { kind: "absent" },
          },
        ],
      },
      signal,
    );
    signal.throwIfAborted();

    const edit = this.#dependencies.createWorkspaceEdit();
    const target = await this.#dependencies.resolveTarget(plan.uri, signal);
    signal.throwIfAborted();
    this.#assertCurrent(plan, target);
    this.#dependencies.deleteFile(edit, target.resource);

    // VS Code exposes no cancellation input after this atomic operation is submitted.
    this.#dependencies.assertCanApply();
    const applied = await this.#dependencies.applyWorkspaceEdit(edit);
    if (!applied) {
      throw new FileDeleteApplyError();
    }
  }

  #assertCurrent(
    plan: FileDeletePlan,
    current: FileDeleteTarget<Resource>,
  ): asserts current is FileDeleteTarget<Resource> & { readonly text: string } {
    if (
      !current.exists ||
      current.resource.toString() !== plan.uri ||
      current.text === undefined ||
      this.#dependencies.hashText(current.text) !== plan.beforeHash
    ) {
      throw new FileDeleteConflictError();
    }
  }
}
