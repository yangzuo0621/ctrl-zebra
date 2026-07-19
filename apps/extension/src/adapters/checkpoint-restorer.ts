import type { TextPosition, TextRange } from "@ctrl-zebra/core";
import type { Checkpoint, CheckpointFile } from "@ctrl-zebra/protocol";

export interface CheckpointRestoreResource {
  toString(): string;
}

export interface CheckpointRestoreDocument<Resource extends CheckpointRestoreResource> {
  readonly uri: Resource;
  readonly text: string;
  readonly end: TextPosition;
}

export interface CheckpointRestorerDependencies<Resource extends CheckpointRestoreResource, Edit> {
  readonly loadCheckpoint: (
    checkpointId: unknown,
    signal: AbortSignal,
  ) => Promise<Checkpoint | undefined>;
  readonly resolveDocument: (
    uri: string,
    signal: AbortSignal,
  ) => Promise<CheckpointRestoreDocument<Resource>>;
  readonly createWorkspaceEdit: () => Edit;
  readonly replace: (edit: Edit, uri: Resource, range: TextRange, text: string) => void;
  readonly applyWorkspaceEdit: (edit: Edit) => Promise<boolean>;
  readonly hashText: (text: string) => string;
}

export class CheckpointNotFoundError extends Error {
  constructor() {
    super("The requested Checkpoint does not exist.");
    this.name = "CheckpointNotFoundError";
  }
}

export class CheckpointRestoreConflictError extends Error {
  constructor() {
    super("A Checkpoint target changed after the Agent edit and was not restored.");
    this.name = "CheckpointRestoreConflictError";
  }
}

export class CheckpointRestoreApplyError extends Error {
  constructor() {
    super("VS Code could not apply the Checkpoint restoration.");
    this.name = "CheckpointRestoreApplyError";
  }
}

export class CheckpointRestoreVerificationError extends Error {
  constructor() {
    super("The restored files do not match the Checkpoint before-content hashes.");
    this.name = "CheckpointRestoreVerificationError";
  }
}

export class CheckpointRestorer<Resource extends CheckpointRestoreResource, Edit> {
  readonly #dependencies: CheckpointRestorerDependencies<Resource, Edit>;

  constructor(dependencies: CheckpointRestorerDependencies<Resource, Edit>) {
    this.#dependencies = dependencies;
  }

  async restore(checkpointId: unknown, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    const checkpoint = await this.#dependencies.loadCheckpoint(checkpointId, signal);
    signal.throwIfAborted();
    if (checkpoint === undefined) {
      throw new CheckpointNotFoundError();
    }

    await this.#resolveAndValidate(checkpoint.files, "afterHash", signal, "conflict");
    signal.throwIfAborted();
    const documents = await this.#resolveAndValidate(
      checkpoint.files,
      "afterHash",
      signal,
      "conflict",
    );
    signal.throwIfAborted();

    const workspaceEdit = this.#dependencies.createWorkspaceEdit();
    for (let index = 0; index < checkpoint.files.length; index += 1) {
      const file = checkpoint.files[index];
      const document = documents[index];
      if (file === undefined || document === undefined) {
        throw new CheckpointRestoreConflictError();
      }
      this.#dependencies.replace(
        workspaceEdit,
        document.uri,
        { start: { line: 0, character: 0 }, end: document.end },
        file.beforeContent,
      );
    }

    const applied = await this.#dependencies.applyWorkspaceEdit(workspaceEdit);
    if (!applied) {
      throw new CheckpointRestoreApplyError();
    }
    await this.#resolveAndValidate(checkpoint.files, "beforeHash", signal, "verification");
  }

  async #resolveAndValidate(
    files: readonly CheckpointFile[],
    hash: "beforeHash" | "afterHash",
    signal: AbortSignal,
    failure: "conflict" | "verification",
  ): Promise<readonly CheckpointRestoreDocument<Resource>[]> {
    const documents: CheckpointRestoreDocument<Resource>[] = [];
    for (const file of files) {
      signal.throwIfAborted();
      let document: CheckpointRestoreDocument<Resource>;
      try {
        document = await this.#dependencies.resolveDocument(file.uri, signal);
      } catch {
        signal.throwIfAborted();
        if (failure === "verification") {
          throw new CheckpointRestoreVerificationError();
        }
        throw new CheckpointRestoreConflictError();
      }
      signal.throwIfAborted();
      if (
        document.uri.toString() !== file.uri ||
        this.#dependencies.hashText(document.text) !== file[hash]
      ) {
        if (failure === "verification") {
          throw new CheckpointRestoreVerificationError();
        }
        throw new CheckpointRestoreConflictError();
      }
      documents.push(document);
    }
    return documents;
  }
}
