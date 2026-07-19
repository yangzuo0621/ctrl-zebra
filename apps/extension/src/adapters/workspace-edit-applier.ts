import type { TextEditPlan, TextPosition, TextRange } from "@ctrl-zebra/core";

export interface WorkspaceEditResource {
  toString(): string;
}

export interface WorkspaceEditDocument<Resource extends WorkspaceEditResource> {
  readonly uri: Resource;
  readonly version: number;
  readonly text: string;
  isValidPosition(position: TextPosition): boolean;
}

export interface WorkspaceEditApplierDependencies<Resource extends WorkspaceEditResource, Edit> {
  readonly resolveDocument: (
    uri: string,
    signal: AbortSignal,
  ) => Promise<WorkspaceEditDocument<Resource>>;
  readonly createWorkspaceEdit: () => Edit;
  readonly replace: (edit: Edit, uri: Resource, range: TextRange, newText: string) => void;
  readonly applyWorkspaceEdit: (edit: Edit) => Promise<boolean>;
  readonly hashText: (text: string) => string;
}

export class WorkspaceEditConflictError extends Error {
  constructor() {
    super("The target file changed before the approved edit could be applied.");
    this.name = "WorkspaceEditConflictError";
  }
}

export class InvalidWorkspaceEditRangeError extends Error {
  constructor() {
    super("An approved text edit range is outside the target document.");
    this.name = "InvalidWorkspaceEditRangeError";
  }
}

export class WorkspaceEditApplyError extends Error {
  constructor() {
    super("VS Code could not apply the approved workspace edit.");
    this.name = "WorkspaceEditApplyError";
  }
}

export class WorkspaceEditApplier<Resource extends WorkspaceEditResource, Edit> {
  readonly #dependencies: WorkspaceEditApplierDependencies<Resource, Edit>;

  constructor(dependencies: WorkspaceEditApplierDependencies<Resource, Edit>) {
    this.#dependencies = dependencies;
  }

  async apply(plan: TextEditPlan, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    const document = await this.#dependencies.resolveDocument(plan.uri, signal);
    signal.throwIfAborted();
    this.#assertCurrentRevision(plan, document);

    const workspaceEdit = this.#dependencies.createWorkspaceEdit();
    for (const edit of plan.edits) {
      if (
        !document.isValidPosition(edit.range.start) ||
        !document.isValidPosition(edit.range.end)
      ) {
        throw new InvalidWorkspaceEditRangeError();
      }

      this.#dependencies.replace(workspaceEdit, document.uri, edit.range, edit.newText);
    }

    signal.throwIfAborted();
    // VS Code exposes no cancellation input after this atomic text-only operation is submitted.
    const applied = await this.#dependencies.applyWorkspaceEdit(workspaceEdit);
    if (!applied) {
      throw new WorkspaceEditApplyError();
    }
  }

  #assertCurrentRevision(plan: TextEditPlan, document: WorkspaceEditDocument<Resource>): void {
    if (document.uri.toString() !== plan.uri) {
      throw new WorkspaceEditConflictError();
    }

    const revision = plan.originalRevision;
    const current =
      revision.kind === "document_version"
        ? document.version === revision.value
        : this.#dependencies.hashText(document.text) === revision.value;
    if (!current) {
      throw new WorkspaceEditConflictError();
    }
  }
}
