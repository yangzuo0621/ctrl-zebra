import type { FileRenamePlan } from "@ctrl-zebra/core";
import type { Checkpoint, CheckpointRunId, SessionId } from "@ctrl-zebra/protocol";

export interface FileRenameOwnership {
  readonly sessionId: SessionId;
  readonly runId: CheckpointRunId;
}

export interface FileRenameResource {
  toString(): string;
}

export interface FileRenameTarget<Resource extends FileRenameResource> {
  readonly resource: Resource;
  readonly exists: boolean;
  readonly text?: string;
}

export interface FileRenameApplierDependencies<Resource extends FileRenameResource, Edit> {
  readonly resolveTarget: (uri: string, signal: AbortSignal) => Promise<FileRenameTarget<Resource>>;
  readonly createWorkspaceEdit: () => Edit;
  readonly renameFile: (edit: Edit, source: Resource, target: Resource) => void;
  readonly assertCanApply: () => void;
  readonly applyWorkspaceEdit: (edit: Edit) => Promise<boolean>;
  readonly hashText: (text: string) => string;
  readonly createCheckpoint: (checkpoint: Checkpoint, signal: AbortSignal) => Promise<void>;
  readonly createId: () => string;
  readonly now: () => Date;
}

export class FileRenameConflictError extends Error {
  constructor() {
    super("The rename source or target changed before the approved rename could be applied.");
    this.name = "FileRenameConflictError";
  }
}

export class FileRenameApplyError extends Error {
  constructor() {
    super("The host could not apply the approved file rename.");
    this.name = "FileRenameApplyError";
  }
}

export class FileRenameApplier<Resource extends FileRenameResource, Edit> {
  readonly #dependencies: FileRenameApplierDependencies<Resource, Edit>;

  constructor(dependencies: FileRenameApplierDependencies<Resource, Edit>) {
    this.#dependencies = dependencies;
  }

  async apply(
    plan: FileRenamePlan,
    ownership: FileRenameOwnership,
    signal: AbortSignal,
  ): Promise<void> {
    signal.throwIfAborted();
    const source = await this.#dependencies.resolveTarget(plan.sourceUri, signal);
    signal.throwIfAborted();
    const target = await this.#dependencies.resolveTarget(plan.targetUri, signal);
    signal.throwIfAborted();
    this.#assertCurrent(plan, source, target);

    await this.#dependencies.createCheckpoint(
      {
        id: this.#dependencies.createId(),
        sessionId: ownership.sessionId,
        runId: ownership.runId,
        createdAt: this.#dependencies.now().toISOString(),
        files: [
          {
            uri: plan.sourceUri,
            before: {
              kind: "text",
              content: plan.beforeContent,
              beforeHash: plan.beforeHash,
            },
            after: { kind: "absent" },
          },
          {
            uri: plan.targetUri,
            before: { kind: "absent" },
            after: { kind: "text", afterHash: plan.beforeHash },
          },
        ],
      },
      signal,
    );
    signal.throwIfAborted();

    const edit = this.#dependencies.createWorkspaceEdit();
    const currentSource = await this.#dependencies.resolveTarget(plan.sourceUri, signal);
    signal.throwIfAborted();
    const currentTarget = await this.#dependencies.resolveTarget(plan.targetUri, signal);
    signal.throwIfAborted();
    this.#assertCurrent(plan, currentSource, currentTarget);
    this.#dependencies.renameFile(edit, currentSource.resource, currentTarget.resource);

    // VS Code exposes no cancellation input after this atomic operation is submitted.
    this.#dependencies.assertCanApply();
    const applied = await this.#dependencies.applyWorkspaceEdit(edit);
    if (!applied) {
      throw new FileRenameApplyError();
    }
  }

  #assertCurrent(
    plan: FileRenamePlan,
    source: FileRenameTarget<Resource>,
    target: FileRenameTarget<Resource>,
  ): void {
    if (
      !source.exists ||
      source.resource.toString() !== plan.sourceUri ||
      source.text === undefined ||
      this.#dependencies.hashText(source.text) !== plan.beforeHash ||
      target.exists ||
      target.resource.toString() !== plan.targetUri
    ) {
      throw new FileRenameConflictError();
    }
  }
}
