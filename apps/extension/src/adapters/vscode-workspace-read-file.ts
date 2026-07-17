import { Uri } from "vscode";

import { readLocalFilePrefix } from "./read-local-file-prefix.js";
import type { JoinWorkspacePath, ReadWorkspaceFilePrefix } from "./workspace-file-reader.js";

export const joinWorkspacePath: JoinWorkspacePath = (root, path) => Uri.joinPath(root, path);

export const readWorkspaceFilePrefix: ReadWorkspaceFilePrefix = async (
  target,
  maxBytes,
  signal,
) => {
  if (target.scheme !== "file") {
    throw new Error("Bounded workspace reads require a local file URI.");
  }

  return readLocalFilePrefix(target.fsPath, maxBytes, signal);
};
