import type {
  CheckpointStore,
  FileCreatePlan,
  FileDeletePlan,
  FileRenamePlan,
  WorkspaceEditPlan,
} from "@ctrl-zebra/core";
import type { Checkpoint } from "@ctrl-zebra/protocol";
import { Uri } from "vscode";

import { FileCreateApprovalWorkflow } from "../controllers/file-create-approval-workflow.js";
import { FileDeleteApprovalWorkflow } from "../controllers/file-delete-approval-workflow.js";
import { FileEditApprovalWorkflow } from "../controllers/file-edit-approval-workflow.js";
import { FileRenameApprovalWorkflow } from "../controllers/file-rename-approval-workflow.js";
import { WorkspaceEditApprovalWorkflow } from "../controllers/workspace-edit-approval-workflow.js";
import type { WorkspaceTrustPolicy } from "../controllers/workspace-trust-policy.js";
import { createVsCodeDiffPresenter } from "./create-vscode-diff-presenter.js";
import { createVsCodeFileCreateApplier } from "./create-vscode-file-create-applier.js";
import { createVsCodeFileDeleteApplier } from "./create-vscode-file-delete-applier.js";
import { createVsCodeFileRenameApplier } from "./create-vscode-file-rename-applier.js";
import { createVsCodeWorkspaceEditApplier } from "./create-vscode-workspace-edit-applier.js";
import type { DiffPresenter } from "./diff-presenter.js";
import { FileCreateConflictError } from "./file-create-applier.js";
import { FileDeleteConflictError } from "./file-delete-applier.js";
import { FileRenameConflictError } from "./file-rename-applier.js";
import { VsCodeProposeFileCreateWorkspace } from "./vscode-propose-file-create-workspace.js";
import { VsCodeProposeFileDeleteRenameWorkspace } from "./vscode-propose-file-delete-rename-workspace.js";
import { joinWorkspacePath } from "./vscode-workspace-read-file.js";
import { WorkspaceEditConflictError } from "./workspace-edit-applier.js";
import {
  type CanonicalizeWorkspaceUri,
  WorkspaceScope,
  WorkspaceScopeError,
} from "./workspace-scope.js";

export interface VsCodeFileMutationApprovalComposition {
  readonly diffPresenter: DiffPresenter;
  readonly fileEdits: FileEditApprovalWorkflow;
  readonly workspaceEdits: WorkspaceEditApprovalWorkflow;
  readonly fileCreates: FileCreateApprovalWorkflow;
  readonly fileDeletes: FileDeleteApprovalWorkflow;
  readonly fileRenames: FileRenameApprovalWorkflow;
}

interface VsCodeFileMutationApprovalDependencies {
  readonly getSelectedRoot: () => Uri;
  readonly canonicalize: CanonicalizeWorkspaceUri;
  readonly selectCheckpointStore: () => Promise<CheckpointStore>;
  readonly hashText: (text: string) => string;
  readonly createId: () => string;
  readonly now: () => Date;
  readonly reportError: (message: string) => void;
  readonly workspaceTrust: WorkspaceTrustPolicy;
}

/**
 * Owns the complete VS Code binding for file-mutation approvals. Approval state remains in the
 * operation workflows; the returned owners are transferred to ToolApprovalWorkflowRouter and the
 * Diff Presenter is transferred to the Extension subscription lifecycle.
 */
export function createVsCodeFileMutationApprovalWorkflows(
  dependencies: VsCodeFileMutationApprovalDependencies,
): VsCodeFileMutationApprovalComposition {
  const diffPresenter = createVsCodeDiffPresenter();
  const createCurrentScope = () =>
    new WorkspaceScope(dependencies.getSelectedRoot(), dependencies.canonicalize);
  const bindSinglePlan = async (
    serializedUri: string,
    signal: AbortSignal,
    mode: "existing" | "new" = "existing",
  ): Promise<string> => {
    const root = dependencies.getSelectedRoot();
    const scope = new WorkspaceScope(root, dependencies.canonicalize);
    const requested = Uri.parse(serializedUri, true);
    const canonical =
      mode === "new"
        ? await scope.validateNewFile(requested, signal)
        : await scope.validate(requested, signal);
    assertCanonicalIdentity(canonical, serializedUri);
    return root.toString();
  };
  const validateWorkspaceEditPlan = async (
    plan: WorkspaceEditPlan,
    signal: AbortSignal,
  ): Promise<void> => {
    const scope = createCurrentScope();
    for (const file of plan.files) {
      const canonical = await scope.validate(Uri.parse(file.uri, true), signal);
      signal.throwIfAborted();
      assertCanonicalIdentity(canonical, file.uri);
    }
  };
  const workflowDependencies = {
    createId: dependencies.createId,
    now: dependencies.now,
    reportError: dependencies.reportError,
    workspaceTrust: dependencies.workspaceTrust,
  };

  const fileEdits = new FileEditApprovalWorkflow({
    ...workflowDependencies,
    bindPlan: (plan, signal) => bindSinglePlan(plan.uri, signal),
    async validatePlan(plan, signal) {
      const canonical = await createCurrentScope().validate(Uri.parse(plan.uri, true), signal);
      assertCanonicalIdentity(canonical, plan.uri);
    },
    presentDiff: (plan, signal) => diffPresenter.present(plan, signal),
    applyPlan: (plan, ownership, signal) =>
      applyWithCheckpoint(
        dependencies,
        createCurrentScope,
        (scope, createCheckpoint) =>
          createVsCodeWorkspaceEditApplier(
            scope,
            createCheckpoint,
            dependencies.createId,
            dependencies.now,
            () => dependencies.workspaceTrust.requireTrusted(),
          ),
        isWorkspaceEditConflict,
        plan,
        ownership,
        signal,
      ),
  });

  const workspaceEdits = new WorkspaceEditApprovalWorkflow({
    ...workflowDependencies,
    async bindPlan(plan, signal) {
      const root = dependencies.getSelectedRoot();
      const scope = new WorkspaceScope(root, dependencies.canonicalize);
      await validateWorkspaceEditPlanWithScope(plan, scope, signal);
      return root.toString();
    },
    validatePlan: validateWorkspaceEditPlan,
    async presentDiff(plan, signal) {
      await validateWorkspaceEditPlan(plan, signal);
      for (const file of plan.files) {
        await diffPresenter.present(file, signal, { requireBoundedText: true });
      }
    },
    applyPlan: (plan, ownership, signal) =>
      applyWithCheckpoint(
        dependencies,
        createCurrentScope,
        (scope, createCheckpoint) =>
          createVsCodeWorkspaceEditApplier(
            scope,
            createCheckpoint,
            dependencies.createId,
            dependencies.now,
            () => dependencies.workspaceTrust.requireTrusted(),
            { requireSupportedText: true },
          ),
        isWorkspaceEditConflict,
        plan,
        ownership,
        signal,
      ),
  });

  const validateFileCreatePlan = async (
    plan: FileCreatePlan,
    signal: AbortSignal,
  ): Promise<void> => {
    const root = dependencies.getSelectedRoot();
    const current = await new VsCodeProposeFileCreateWorkspace(
      root,
      new WorkspaceScope(root, dependencies.canonicalize),
      joinWorkspacePath,
    ).isFileCreateTargetAbsent(plan, signal);
    if (!current) throw new FileCreateConflictError();
  };
  const fileCreates = new FileCreateApprovalWorkflow({
    ...workflowDependencies,
    hashText: dependencies.hashText,
    bindPlan: (plan, signal) => bindSinglePlan(plan.uri, signal, "new"),
    validatePlan: validateFileCreatePlan,
    async presentDiff(plan, signal) {
      await validateFileCreatePlan(plan, signal);
      await diffPresenter.presentTextPair(plan.path, "", plan.content, signal);
    },
    applyPlan: (plan, ownership, signal) =>
      applyWithCheckpoint(
        dependencies,
        createCurrentScope,
        (scope, createCheckpoint) =>
          createVsCodeFileCreateApplier(
            scope,
            createCheckpoint,
            dependencies.createId,
            dependencies.now,
            () => dependencies.workspaceTrust.requireTrusted(),
          ),
        isFileCreateConflict,
        plan,
        ownership,
        signal,
      ),
  });

  const validateFileDeletePlan = async (
    plan: FileDeletePlan,
    signal: AbortSignal,
  ): Promise<void> => {
    const root = dependencies.getSelectedRoot();
    const current = await new VsCodeProposeFileDeleteRenameWorkspace(
      root,
      new WorkspaceScope(root, dependencies.canonicalize),
      joinWorkspacePath,
    ).isFileDeleteTargetCurrent(plan, signal);
    if (!current) throw new FileDeleteConflictError();
  };
  const fileDeletes = new FileDeleteApprovalWorkflow({
    ...workflowDependencies,
    hashText: dependencies.hashText,
    bindPlan: (plan, signal) => bindSinglePlan(plan.uri, signal),
    validatePlan: validateFileDeletePlan,
    presentDiff: (plan, signal) =>
      diffPresenter.presentTextPair(plan.path, plan.beforeContent, "", signal),
    applyPlan: (plan, ownership, signal) =>
      applyWithCheckpoint(
        dependencies,
        createCurrentScope,
        (scope, createCheckpoint) =>
          createVsCodeFileDeleteApplier(
            scope,
            createCheckpoint,
            dependencies.createId,
            dependencies.now,
            () => dependencies.workspaceTrust.requireTrusted(),
          ),
        isFileDeleteConflict,
        plan,
        ownership,
        signal,
      ),
  });

  const validateFileRenamePlan = async (
    plan: FileRenamePlan,
    signal: AbortSignal,
  ): Promise<void> => {
    const root = dependencies.getSelectedRoot();
    const current = await new VsCodeProposeFileDeleteRenameWorkspace(
      root,
      new WorkspaceScope(root, dependencies.canonicalize),
      joinWorkspacePath,
    ).isFileRenameTargetCurrent(plan, signal);
    if (!current) throw new FileRenameConflictError();
  };
  const fileRenames = new FileRenameApprovalWorkflow({
    ...workflowDependencies,
    hashText: dependencies.hashText,
    async bindPlan(plan, signal) {
      const root = dependencies.getSelectedRoot();
      const scope = new WorkspaceScope(root, dependencies.canonicalize);
      const source = await scope.validate(Uri.parse(plan.sourceUri, true), signal);
      signal.throwIfAborted();
      const target = await scope.validateNewFile(Uri.parse(plan.targetUri, true), signal);
      signal.throwIfAborted();
      assertCanonicalIdentity(source, plan.sourceUri);
      assertCanonicalIdentity(target, plan.targetUri);
      return root.toString();
    },
    validatePlan: validateFileRenamePlan,
    presentDiff: (plan, signal) =>
      diffPresenter.presentTextPair(
        `${plan.sourcePath} → ${plan.targetPath}`,
        plan.beforeContent,
        plan.beforeContent,
        signal,
      ),
    applyPlan: (plan, ownership, signal) =>
      applyWithCheckpoint(
        dependencies,
        createCurrentScope,
        (scope, createCheckpoint) =>
          createVsCodeFileRenameApplier(
            scope,
            createCheckpoint,
            dependencies.createId,
            dependencies.now,
            () => dependencies.workspaceTrust.requireTrusted(),
          ),
        isFileRenameConflict,
        plan,
        ownership,
        signal,
      ),
  });

  return { diffPresenter, fileEdits, workspaceEdits, fileCreates, fileDeletes, fileRenames };
}

interface PlanApplier<Plan> {
  apply(
    plan: Plan,
    ownership: { readonly sessionId: string; readonly runId: string },
    signal: AbortSignal,
  ): Promise<void>;
}

async function applyWithCheckpoint<Plan>(
  dependencies: VsCodeFileMutationApprovalDependencies,
  createCurrentScope: () => WorkspaceScope,
  createApplier: (
    scope: WorkspaceScope,
    createCheckpoint: (checkpoint: Checkpoint, signal: AbortSignal) => Promise<void>,
  ) => PlanApplier<Plan>,
  isConflict: (error: unknown) => boolean,
  plan: Plan,
  ownership: { readonly sessionId: string; readonly runId: string },
  signal: AbortSignal,
): Promise<"applied" | "conflict"> {
  try {
    const checkpointStore = await dependencies.selectCheckpointStore();
    signal.throwIfAborted();
    await createApplier(createCurrentScope(), async (checkpoint, checkpointSignal) => {
      await checkpointStore.create(checkpoint, checkpointSignal);
    }).apply(plan, ownership, signal);
    return "applied";
  } catch (error) {
    if (isConflict(error) || error instanceof WorkspaceScopeError) return "conflict";
    throw error;
  }
}

async function validateWorkspaceEditPlanWithScope(
  plan: WorkspaceEditPlan,
  scope: WorkspaceScope,
  signal: AbortSignal,
): Promise<void> {
  for (const file of plan.files) {
    const canonical = await scope.validate(Uri.parse(file.uri, true), signal);
    signal.throwIfAborted();
    assertCanonicalIdentity(canonical, file.uri);
  }
}

function assertCanonicalIdentity(canonical: Uri, serializedUri: string): void {
  if (canonical.toString() !== serializedUri) {
    throw new WorkspaceScopeError("canonicalization-failed");
  }
}

function isWorkspaceEditConflict(error: unknown): boolean {
  return error instanceof WorkspaceEditConflictError;
}

function isFileCreateConflict(error: unknown): boolean {
  return error instanceof FileCreateConflictError;
}

function isFileDeleteConflict(error: unknown): boolean {
  return error instanceof FileDeleteConflictError;
}

function isFileRenameConflict(error: unknown): boolean {
  return error instanceof FileRenameConflictError;
}
