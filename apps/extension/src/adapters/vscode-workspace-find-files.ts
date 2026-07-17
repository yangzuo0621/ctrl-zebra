import { CancellationTokenSource, RelativePattern, workspace } from "vscode";

import type { WorkspaceFindFiles } from "./workspace-file-lister.js";

export const findWorkspaceFiles: WorkspaceFindFiles = async (request, signal) => {
  signal.throwIfAborted();
  const cancellation = new CancellationTokenSource();
  const cancelSearch = () => cancellation.cancel();
  signal.addEventListener("abort", cancelSearch, { once: true });

  try {
    const targets = await workspace.findFiles(
      new RelativePattern(request.baseUri, request.glob),
      new RelativePattern(request.baseUri, request.excludeGlob),
      request.maxResults,
      cancellation.token,
    );
    signal.throwIfAborted();
    return targets;
  } finally {
    signal.removeEventListener("abort", cancelSearch);
    cancellation.dispose();
  }
};
