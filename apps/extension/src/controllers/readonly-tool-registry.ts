import {
  createListFilesTool,
  createProposeFileEditTool,
  createReadFileTool,
  createRunCommandTool,
  createSearchFilesTool,
  type ProposeFileEditWorkspace,
  type RunCommandExecutor,
} from "@ctrl-zebra/builtin-tools";
import { ToolRegistry } from "@ctrl-zebra/core";
import type { Disposable, Uri } from "vscode";

import { WorkspaceFileLister, type WorkspaceFindFiles } from "../adapters/workspace-file-lister.js";
import {
  type JoinWorkspacePath,
  type ReadWorkspaceFilePrefix,
  WorkspaceFileReader,
} from "../adapters/workspace-file-reader.js";
import { type CanonicalizeWorkspaceUri, WorkspaceScope } from "../adapters/workspace-scope.js";
import { WorkspaceSearchFiles } from "../adapters/workspace-search-files.js";
import type { WorkspaceTrustPolicy } from "./workspace-trust-policy.js";

export type WorkspaceRootSelectionErrorCode = "missing-workspace" | "ambiguous-workspace";

export class WorkspaceRootSelectionError extends Error {
  constructor(readonly code: WorkspaceRootSelectionErrorCode) {
    super(
      code === "missing-workspace"
        ? "Open a workspace folder before using workspace tools."
        : "Select exactly one workspace folder before using workspace tools.",
    );
    this.name = "WorkspaceRootSelectionError";
  }
}

export interface WorkspaceToolRegistryProvider extends Disposable {
  get(signal: AbortSignal): Promise<ToolRegistry>;
}

interface WorkspaceToolRegistryDependencies {
  readonly getWorkspaceRoots: () => readonly Uri[];
  readonly canonicalize: CanonicalizeWorkspaceUri;
  readonly findFiles: WorkspaceFindFiles;
  readonly joinPath: JoinWorkspacePath;
  readonly readPrefix: ReadWorkspaceFilePrefix;
  readonly onDidChangeWorkspaceFolders: (listener: () => void) => Disposable;
  readonly onDidGrantWorkspaceTrust: (listener: () => void) => Disposable;
  readonly createProposeFileEditWorkspace: (
    root: Uri,
    scope: WorkspaceScope,
  ) => ProposeFileEditWorkspace;
  readonly commandExecutor: RunCommandExecutor;
  readonly workspaceTrust: WorkspaceTrustPolicy;
}

export function createWorkspaceToolRegistryProvider({
  getWorkspaceRoots,
  canonicalize,
  findFiles,
  joinPath,
  readPrefix,
  onDidChangeWorkspaceFolders,
  onDidGrantWorkspaceTrust,
  createProposeFileEditWorkspace,
  commandExecutor,
  workspaceTrust,
}: WorkspaceToolRegistryDependencies): WorkspaceToolRegistryProvider {
  let initialization: Promise<ToolRegistry> | undefined;
  let disposed = false;

  const invalidateRegistration = onDidChangeWorkspaceFolders(() => {
    initialization = undefined;
  });
  const invalidateTrustRegistration = onDidGrantWorkspaceTrust(() => {
    initialization = undefined;
  });

  const initialize = (): ToolRegistry => {
    const selectedRoot = selectWorkspaceRoot(getWorkspaceRoots());
    const scope = new WorkspaceScope(selectedRoot, canonicalize);
    const lister = new WorkspaceFileLister(selectedRoot, scope, findFiles);
    const reader = new WorkspaceFileReader(selectedRoot, scope, joinPath, readPrefix);
    const registry = new ToolRegistry();

    registry.register(createListFilesTool(lister));
    registry.register(createReadFileTool(reader));
    registry.register(createSearchFilesTool(new WorkspaceSearchFiles(lister, reader)));
    if (workspaceTrust.isTrusted()) {
      registry.register(
        createProposeFileEditTool(createProposeFileEditWorkspace(selectedRoot, scope)),
      );
      registry.register(createRunCommandTool(commandExecutor));
    }
    return registry;
  };

  return {
    async get(signal) {
      signal.throwIfAborted();
      if (disposed) {
        throw new Error("Readonly Tool Registry provider has been disposed.");
      }

      const current = initialization ?? Promise.resolve().then(initialize);
      initialization = current;

      try {
        const registry = await current;
        signal.throwIfAborted();
        return registry;
      } catch (error) {
        if (initialization === current) {
          initialization = undefined;
        }
        throw error;
      }
    },
    dispose() {
      if (disposed) {
        return;
      }

      disposed = true;
      initialization = undefined;
      invalidateRegistration.dispose();
      invalidateTrustRegistration.dispose();
    },
  };
}

export function selectWorkspaceRoot(roots: readonly Uri[]): Uri {
  if (roots.length === 0) {
    throw new WorkspaceRootSelectionError("missing-workspace");
  }

  if (roots.length !== 1) {
    throw new WorkspaceRootSelectionError("ambiguous-workspace");
  }

  const selectedRoot = roots[0];
  if (selectedRoot === undefined) {
    throw new WorkspaceRootSelectionError("missing-workspace");
  }

  return selectedRoot;
}
