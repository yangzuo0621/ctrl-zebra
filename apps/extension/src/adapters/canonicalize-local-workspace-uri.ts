import type { Uri } from "vscode";

import type { CanonicalizeWorkspaceUri } from "./workspace-scope.js";

export type ResolveRealPath = (path: string) => Promise<string>;
export type CreateFileUri = (path: string) => Uri;

export function createLocalWorkspaceUriCanonicalizer(
  resolveRealPath: ResolveRealPath,
  createFileUri: CreateFileUri,
): CanonicalizeWorkspaceUri {
  return async (uri, signal) => {
    signal.throwIfAborted();
    if (uri.scheme !== "file") {
      throw new Error("Canonical workspace access requires a local file URI.");
    }

    const path = await resolveRealPath(uri.fsPath);
    signal.throwIfAborted();
    return createFileUri(path);
  };
}
