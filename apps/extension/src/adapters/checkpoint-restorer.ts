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
  ) => Promise<CheckpointRestoreDocument<Resource> | undefined>;
  readonly createWorkspaceEdit: () => Edit;
  readonly createResource?: (uri: string) => Resource;
  readonly replace: (edit: Edit, uri: Resource, range: TextRange, text: string) => void;
  readonly createFile?: (edit: Edit, uri: Resource) => void;
  readonly insert?: (edit: Edit, uri: Resource, text: string) => void;
  readonly deleteFile?: (edit: Edit, uri: Resource) => void;
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

    await this.#resolveAndValidateAfter(checkpoint.files, signal);
    signal.throwIfAborted();
    const afterDocuments = await this.#resolveAndValidateAfter(checkpoint.files, signal);
    signal.throwIfAborted();

    const workspaceEdit = this.#dependencies.createWorkspaceEdit();
    for (let index = 0; index < checkpoint.files.length; index += 1) {
      const file = checkpoint.files[index];
      const document = afterDocuments[index];
      if (file === undefined) {
        throw new CheckpointRestoreConflictError();
      }
      this.#applyBeforeState(workspaceEdit, file, document);
    }

    const applied = await this.#dependencies.applyWorkspaceEdit(workspaceEdit);
    if (!applied) {
      throw new CheckpointRestoreApplyError();
    }
    await this.#resolveAndValidateBefore(checkpoint.files, signal);
  }

  async #resolveAndValidateAfter(
    files: readonly CheckpointFile[],
    signal: AbortSignal,
  ): Promise<readonly (CheckpointRestoreDocument<Resource> | undefined)[]> {
    return this.#resolveAndValidateState(files, "after", signal, "conflict");
  }

  async #resolveAndValidateBefore(
    files: readonly CheckpointFile[],
    signal: AbortSignal,
  ): Promise<readonly (CheckpointRestoreDocument<Resource> | undefined)[]> {
    return this.#resolveAndValidateState(files, "before", signal, "verification");
  }

  async #resolveAndValidateState(
    files: readonly CheckpointFile[],
    state: "before" | "after",
    signal: AbortSignal,
    failure: "conflict" | "verification",
  ): Promise<readonly (CheckpointRestoreDocument<Resource> | undefined)[]> {
    const documents: (CheckpointRestoreDocument<Resource> | undefined)[] = [];
    for (const file of files) {
      signal.throwIfAborted();
      const expected = getState(file, state);
      let document: CheckpointRestoreDocument<Resource> | undefined;
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
      if (!matchesState(document, expected, this.#dependencies.hashText, file.uri)) {
        if (failure === "verification") {
          throw new CheckpointRestoreVerificationError();
        }
        throw new CheckpointRestoreConflictError();
      }
      documents.push(document);
    }
    return documents;
  }

  #applyBeforeState(
    workspaceEdit: Edit,
    file: CheckpointFile,
    current: CheckpointRestoreDocument<Resource> | undefined,
  ): void {
    const before = getState(file, "before");
    const after = getState(file, "after");
    if (before.kind === "absent") {
      if (current === undefined || this.#dependencies.deleteFile === undefined) {
        throw new CheckpointRestoreConflictError();
      }
      this.#dependencies.deleteFile(workspaceEdit, current.uri);
      return;
    }

    if (after.kind === "absent") {
      if (this.#dependencies.createFile === undefined || this.#dependencies.insert === undefined) {
        throw new CheckpointRestoreConflictError();
      }
      const target = current?.uri;
      if (target !== undefined) {
        throw new CheckpointRestoreConflictError();
      }
      if (this.#dependencies.createResource === undefined) {
        throw new CheckpointRestoreConflictError();
      }
      if (before.content === undefined) {
        throw new CheckpointRestoreConflictError();
      }
      const uri = this.#dependencies.createResource(file.uri);
      this.#dependencies.createFile(workspaceEdit, uri);
      this.#dependencies.insert(workspaceEdit, uri, before.content);
      return;
    }

    if (current === undefined || before.content === undefined) {
      throw new CheckpointRestoreConflictError();
    }
    this.#dependencies.replace(
      workspaceEdit,
      current.uri,
      { start: { line: 0, character: 0 }, end: current.end },
      before.content,
    );
  }
}

type CheckpointState =
  | { readonly kind: "absent" }
  | {
      readonly kind: "text";
      readonly content?: string;
      readonly beforeHash?: string;
      readonly afterHash?: string;
    };

function getState(file: CheckpointFile, state: "before" | "after"): CheckpointState {
  if (
    file.beforeContent !== undefined &&
    file.beforeHash !== undefined &&
    file.afterHash !== undefined
  ) {
    return state === "before"
      ? { kind: "text", content: file.beforeContent, beforeHash: file.beforeHash }
      : { kind: "text", afterHash: file.afterHash };
  }
  const value = state === "before" ? file.before : file.after;
  if (value === undefined) {
    throw new CheckpointRestoreConflictError();
  }
  return value;
}

function matchesState<Resource extends CheckpointRestoreResource>(
  document: CheckpointRestoreDocument<Resource> | undefined,
  expected: CheckpointState,
  hashText: (text: string) => string,
  serializedUri: string,
): boolean {
  if (expected.kind === "absent") {
    return document === undefined;
  }
  if (document === undefined || document.uri.toString() !== serializedUri) {
    return false;
  }
  const expectedHash = expected.afterHash ?? expected.beforeHash;
  return expectedHash === undefined || hashText(document.text) === expectedHash;
}
