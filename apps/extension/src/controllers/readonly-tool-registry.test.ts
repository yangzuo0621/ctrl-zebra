import type { ListFilesInput, ReadFileInput, SearchFilesInput } from "@ctrl-zebra/builtin-tools";
import { describe, expect, it, vi } from "vitest";
import type { Uri } from "vscode";

import type { WorkspaceFindFiles } from "../adapters/workspace-file-lister.js";
import type {
  JoinWorkspacePath,
  ReadWorkspaceFilePrefix,
} from "../adapters/workspace-file-reader.js";

import {
  createReadonlyToolRegistryProvider,
  WorkspaceRootSelectionError,
} from "./readonly-tool-registry.js";

describe("createReadonlyToolRegistryProvider", () => {
  it("initializes lazily, registers each read-only tool once, and binds adapters to the selected root", async () => {
    const root = uri("/workspace");
    const listed = uri("/workspace/src/index.ts");
    const findFiles = vi.fn<WorkspaceFindFiles>(async () => [listed]);
    const readPrefix = vi.fn<ReadWorkspaceFilePrefix>(async () => ({
      bytes: new TextEncoder().encode("zebra\n"),
      truncated: false,
    }));
    const dependencies = createDependencies([root], { findFiles, readPrefix });
    const provider = createReadonlyToolRegistryProvider(dependencies.values);

    expect(findFiles).not.toHaveBeenCalled();
    expect(readPrefix).not.toHaveBeenCalled();

    const signal = new AbortController().signal;
    const [first, second] = await Promise.all([provider.get(signal), provider.get(signal)]);

    expect(second).toBe(first);
    expect(first.declarations().map(({ name }) => name)).toEqual([
      "list_files",
      "read_file",
      "search_files",
    ]);

    const listTool = first.get("list_files");
    const readTool = first.get("read_file");
    const searchTool = first.get("search_files");
    await listTool?.execute({ glob: "**/*", maxResults: 10 } satisfies ListFilesInput, { signal });
    await readTool?.execute({ path: "src/index.ts", startLine: 1 } satisfies ReadFileInput, {
      signal,
    });
    await searchTool?.execute(
      { query: "zebra", glob: "**/*", maxResults: 10 } satisfies SearchFilesInput,
      { signal },
    );

    expect(findFiles.mock.calls.every(([request]) => request.baseUri === root)).toBe(true);
    expect(dependencies.joinPath).toHaveBeenCalledWith(root, "src/index.ts");
    expect(
      readPrefix.mock.calls.map(([target, maxBytes, callSignal]) => ({
        path: target.path,
        maxBytes,
        callSignal,
      })),
    ).toEqual([
      { path: listed.path, maxBytes: 65_540, callSignal: signal },
      { path: listed.path, maxBytes: 262_148, callSignal: signal },
    ]);
    expect(dependencies.registerWorkspaceChange).toHaveBeenCalledOnce();
  });

  it("invalidates the cached composition when workspace folders change", async () => {
    const roots = [uri("/first")];
    const dependencies = createDependencies(roots);
    const provider = createReadonlyToolRegistryProvider(dependencies.values);
    const signal = new AbortController().signal;
    const first = await provider.get(signal);

    roots[0] = uri("/second");
    dependencies.emitWorkspaceChange();
    const second = await provider.get(signal);

    expect(second).not.toBe(first);
    expect(second.declarations()).toHaveLength(3);
  });

  it.each([
    [[], "missing-workspace"],
    [[uri("/first"), uri("/second")], "ambiguous-workspace"],
  ] as const)("rejects an unsafe workspace root selection %#", async (roots, code) => {
    const provider = createReadonlyToolRegistryProvider(createDependencies(roots).values);

    await expect(provider.get(new AbortController().signal)).rejects.toEqual(
      new WorkspaceRootSelectionError(code),
    );
  });

  it("cleans up its listener idempotently and rejects later initialization", async () => {
    const dependencies = createDependencies([uri("/workspace")]);
    const provider = createReadonlyToolRegistryProvider(dependencies.values);

    provider.dispose();
    provider.dispose();

    expect(dependencies.disposeWorkspaceChange).toHaveBeenCalledOnce();
    await expect(provider.get(new AbortController().signal)).rejects.toThrow("has been disposed");
  });
});

function createDependencies(
  roots: readonly Uri[],
  overrides: {
    readonly findFiles?: WorkspaceFindFiles;
    readonly readPrefix?: ReadWorkspaceFilePrefix;
  } = {},
) {
  let workspaceChangeListener: (() => void) | undefined;
  const registerWorkspaceChange = vi.fn((listener: () => void) => {
    workspaceChangeListener = listener;
    return { dispose: disposeWorkspaceChange };
  });
  const disposeWorkspaceChange = vi.fn();
  const joinPath = vi.fn<JoinWorkspacePath>((root, path) =>
    uri(`${root.path}/${path}`, root.scheme, root.authority),
  );

  return {
    values: {
      getWorkspaceRoots: () => roots,
      canonicalize: async (target: Uri) => target,
      findFiles: overrides.findFiles ?? vi.fn<WorkspaceFindFiles>(async () => []),
      joinPath,
      readPrefix:
        overrides.readPrefix ??
        vi.fn<ReadWorkspaceFilePrefix>(async () => ({
          bytes: new Uint8Array(),
          truncated: false,
        })),
      onDidChangeWorkspaceFolders: registerWorkspaceChange,
    },
    joinPath,
    registerWorkspaceChange,
    disposeWorkspaceChange,
    emitWorkspaceChange: () => workspaceChangeListener?.(),
  };
}

function uri(path: string, scheme = "file", authority = ""): Uri {
  return {
    scheme,
    authority,
    path,
    query: "",
    fragment: "",
    fsPath: path,
    with: (change) =>
      uri(change.path ?? path, change.scheme ?? scheme, change.authority ?? authority),
    toString: () => `${scheme}://${authority}${path}`,
    toJSON: () => ({ scheme, authority, path }),
  };
}
