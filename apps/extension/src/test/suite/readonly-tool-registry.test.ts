import assert from "node:assert/strict";
import * as vscode from "vscode";

import { createReadonlyToolRegistryProvider } from "../../controllers/readonly-tool-registry.js";

export async function verifyReadonlyToolRegistration(): Promise<void> {
  const root = vscode.Uri.from({ scheme: "file", path: "/ctrl-zebra-integration-workspace" });
  const target = vscode.Uri.joinPath(root, "README.md");
  let observedBaseUri: vscode.Uri | undefined;
  let workspaceChangeListener: (() => void) | undefined;
  const provider = createReadonlyToolRegistryProvider({
    getWorkspaceRoots: () => [root],
    canonicalize: async (uri) => uri,
    findFiles: async ({ baseUri }) => {
      observedBaseUri = baseUri;
      return [target];
    },
    joinPath: (selectedRoot, path) => vscode.Uri.joinPath(selectedRoot, path),
    readPrefix: async () => ({
      bytes: new TextEncoder().encode("CtrlZebra"),
      truncated: false,
    }),
    onDidChangeWorkspaceFolders: (listener) => {
      workspaceChangeListener = listener;
      return { dispose() {} };
    },
  });
  const signal = new AbortController().signal;

  try {
    const [first, repeated] = await Promise.all([provider.get(signal), provider.get(signal)]);
    assert.equal(first, repeated, "Concurrent initialization must share one Tool Registry.");
    assert.deepEqual(
      first.declarations().map(({ name }) => name),
      ["list_files", "read_file", "search_files"],
    );

    const listFiles = first.get("list_files");
    assert.ok(listFiles, "Expected list_files to be registered.");
    await listFiles.execute(listFiles.parseInput({ maxResults: 10 }), { signal });
    assert.equal(observedBaseUri?.toString(), root.toString());

    workspaceChangeListener?.();
    const refreshed = await provider.get(signal);
    assert.notEqual(refreshed, first, "Workspace changes must invalidate the cached composition.");
    assert.equal(refreshed.declarations().length, 3);
  } finally {
    provider.dispose();
  }
}
