import type {
  IdeContextPort,
  IdeDiagnosticsPort,
  IdeLanguageServicePort,
  ListFilesInput,
  ProposeFileEditWorkspace,
  ReadFileInput,
  SearchFilesInput,
} from "@ctrl-zebra/builtin-tools";
import { describe, expect, it, vi } from "vitest";
import type { TextDocument, TextEditor, Uri } from "vscode";

import { VsCodeEditorContext } from "../adapters/vscode-editor-context.js";
import type { WorkspaceFindFiles } from "../adapters/workspace-file-lister.js";
import type {
  JoinWorkspacePath,
  ReadWorkspaceFilePrefix,
} from "../adapters/workspace-file-reader.js";
import { createTestUri as uri } from "../test/support/test-uri.js";

import {
  createWorkspaceToolRegistryProvider,
  WorkspaceRootSelectionError,
} from "./readonly-tool-registry.js";

describe("createWorkspaceToolRegistryProvider", () => {
  it("initializes lazily, registers each workspace tool once, and binds adapters to the selected root", async () => {
    const root = uri("/workspace");
    const listed = uri("/workspace/src/index.ts");
    const findFiles = vi.fn<WorkspaceFindFiles>(async () => [listed]);
    const readPrefix = vi.fn<ReadWorkspaceFilePrefix>(async () => ({
      bytes: new TextEncoder().encode("zebra\n"),
      truncated: false,
    }));
    const dependencies = createDependencies([root], { findFiles, readPrefix });
    const provider = createWorkspaceToolRegistryProvider(dependencies.values);

    expect(findFiles).not.toHaveBeenCalled();
    expect(readPrefix).not.toHaveBeenCalled();

    const signal = new AbortController().signal;
    const [first, second] = await Promise.all([provider.get(signal), provider.get(signal)]);

    expect(second).toBe(first);
    expect(first.declarations().map(({ name }) => name)).toEqual([
      "list_files",
      "propose_file_edit",
      "read_file",
      "run_command",
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

  it("composes the host editor context as a read-only Tool when supplied", async () => {
    const editorContext: IdeContextPort = {
      readEditorContext: async () => ({
        source: {
          uri: { scheme: "file", authority: "", path: "src/index.ts" },
          stale: false,
          truncated: false,
        },
        text: "text",
      }),
    };
    const provider = createWorkspaceToolRegistryProvider(
      createDependencies([uri("/workspace")], { editorContext }).values,
    );

    const registry = await provider.get(new AbortController().signal);
    expect(registry.declarations().map(({ name }) => name)).toContain("read_editor_context");
    await expect(
      registry
        .get("read_editor_context")
        ?.execute({ scope: "active-editor" }, { signal: new AbortController().signal }),
    ).resolves.toMatchObject({ output: { kind: "editor-context", context: { text: "text" } } });
  });

  it("composes host diagnostics as a read-only Tool when supplied", async () => {
    const diagnostics: IdeDiagnosticsPort = {
      getDiagnostics: async () => ({
        kind: "diagnostics",
        source: {
          uri: { scheme: "file", authority: "", path: "src/index.ts" },
          stale: false,
          truncated: false,
        },
        diagnostics: [],
        stale: false,
        truncated: false,
      }),
    };
    const provider = createWorkspaceToolRegistryProvider(
      createDependencies([uri("/workspace")], { diagnostics }).values,
    );

    const registry = await provider.get(new AbortController().signal);
    expect(registry.declarations().map(({ name }) => name)).toContain("get_diagnostics");
    await expect(
      registry
        .get("get_diagnostics")
        ?.execute({ scope: "workspace" }, { signal: new AbortController().signal }),
    ).resolves.toMatchObject({ output: { kind: "diagnostics", diagnostics: [] } });
  });

  it("composes host language services as three read-only Tools when supplied", async () => {
    const source = {
      uri: { scheme: "file", authority: "", path: "src/index.ts" },
      stale: false,
      truncated: false,
    } as const;
    const range = {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 1 },
    } as const;
    const languageServices: IdeLanguageServicePort = {
      findDefinition: async () => ({
        kind: "language-locations",
        operation: "definition",
        source,
        locations: [{ source, range, kind: "definition" }],
        stale: false,
        truncated: false,
      }),
      findReferences: async () => ({
        kind: "language-locations",
        operation: "references",
        source,
        locations: [{ source, range, kind: "reference" }],
        stale: false,
        truncated: false,
      }),
      listSymbols: async () => ({
        kind: "symbols",
        source,
        symbols: [{ name: "answer", kind: "variable", range }],
        stale: false,
        truncated: false,
      }),
    };
    const provider = createWorkspaceToolRegistryProvider(
      createDependencies([uri("/workspace")], { languageServices }).values,
    );
    const registry = await provider.get(new AbortController().signal);

    expect(registry.declarations().map(({ name }) => name)).toEqual([
      "find_definition",
      "find_references",
      "list_files",
      "list_symbols",
      "propose_file_edit",
      "read_file",
      "run_command",
      "search_files",
    ]);
    const signal = new AbortController().signal;
    await expect(
      registry
        .get("find_definition")
        ?.execute({ path: "src/index.ts", position: { line: 0, character: 0 } }, { signal }),
    ).resolves.toMatchObject({ output: { operation: "definition" } });
    await expect(
      registry
        .get("find_references")
        ?.execute({ path: "src/index.ts", position: { line: 0, character: 0 } }, { signal }),
    ).resolves.toMatchObject({ output: { operation: "references" } });
    await expect(
      registry.get("list_symbols")?.execute({ path: "src/index.ts" }, { signal }),
    ).resolves.toMatchObject({ output: { symbols: [{ name: "answer" }] } });
  });

  it("composes the concrete VS Code editor adapter into the production-shaped registry", async () => {
    const root = uri("/workspace");
    const document = {
      uri: uri("/workspace/src/index.ts"),
      version: 1,
      languageId: "typescript",
      lineCount: 1,
      lineAt: () => ({ text: "text" }),
      getText: () => "text",
    } as unknown as TextDocument;
    const editor = {
      document,
      selection: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 0 },
      },
    } as unknown as TextEditor;
    const editorContext = new VsCodeEditorContext({
      getActiveEditor: () => editor,
      getSelectedRoot: () => root,
      createScope: () => ({ validate: async (target: Uri) => target }),
      isEnabled: () => true,
    });
    const provider = createWorkspaceToolRegistryProvider(
      createDependencies([root], { editorContext }).values,
    );

    const registry = await provider.get(new AbortController().signal);
    await expect(
      registry
        .get("read_editor_context")
        ?.execute({ scope: "active-editor" }, { signal: new AbortController().signal }),
    ).resolves.toMatchObject({
      output: {
        kind: "editor-context",
        context: { source: { uri: { path: "src/index.ts" } }, text: "text" },
      },
    });
  });

  it("invalidates the cached composition when workspace folders change", async () => {
    const roots = [uri("/first")];
    const dependencies = createDependencies(roots);
    const provider = createWorkspaceToolRegistryProvider(dependencies.values);
    const signal = new AbortController().signal;
    const first = await provider.get(signal);

    roots[0] = uri("/second");
    dependencies.emitWorkspaceChange();
    const second = await provider.get(signal);

    expect(second).not.toBe(first);
    expect(second.declarations()).toHaveLength(5);
  });

  it.each([
    [[], "missing-workspace"],
    [[uri("/first"), uri("/second")], "ambiguous-workspace"],
  ] as const)("rejects an unsafe workspace root selection %#", async (roots, code) => {
    const provider = createWorkspaceToolRegistryProvider(createDependencies(roots).values);

    await expect(provider.get(new AbortController().signal)).rejects.toEqual(
      new WorkspaceRootSelectionError(code),
    );
  });

  it("cleans up its listener idempotently and rejects later initialization", async () => {
    const dependencies = createDependencies([uri("/workspace")]);
    const provider = createWorkspaceToolRegistryProvider(dependencies.values);

    provider.dispose();
    provider.dispose();

    expect(dependencies.disposeWorkspaceChange).toHaveBeenCalledOnce();
    expect(dependencies.disposeTrustChange).toHaveBeenCalledOnce();
    await expect(provider.get(new AbortController().signal)).rejects.toThrow("has been disposed");
  });

  it("exposes only read tools until the host grants workspace trust", async () => {
    const dependencies = createDependencies([uri("/workspace")], { trusted: false });
    const provider = createWorkspaceToolRegistryProvider(dependencies.values);
    const signal = new AbortController().signal;

    expect((await provider.get(signal)).declarations().map(({ name }) => name)).toEqual([
      "list_files",
      "read_file",
      "search_files",
    ]);

    dependencies.setTrusted(true);
    dependencies.emitTrustGrant();

    expect((await provider.get(signal)).declarations().map(({ name }) => name)).toEqual([
      "list_files",
      "propose_file_edit",
      "read_file",
      "run_command",
      "search_files",
    ]);
  });
});

function createDependencies(
  roots: readonly Uri[],
  overrides: {
    readonly findFiles?: WorkspaceFindFiles;
    readonly readPrefix?: ReadWorkspaceFilePrefix;
    readonly trusted?: boolean;
    readonly editorContext?: IdeContextPort;
    readonly diagnostics?: IdeDiagnosticsPort;
    readonly languageServices?: IdeLanguageServicePort;
  } = {},
) {
  let trusted = overrides.trusted ?? true;
  let workspaceChangeListener: (() => void) | undefined;
  let trustChangeListener: (() => void) | undefined;
  const registerWorkspaceChange = vi.fn((listener: () => void) => {
    workspaceChangeListener = listener;
    return { dispose: disposeWorkspaceChange };
  });
  const disposeWorkspaceChange = vi.fn();
  const disposeTrustChange = vi.fn();
  const registerTrustChange = vi.fn((listener: () => void) => {
    trustChangeListener = listener;
    return { dispose: disposeTrustChange };
  });
  const joinPath = vi.fn<JoinWorkspacePath>((root, path) =>
    uri({ path: `${root.path}/${path}`, scheme: root.scheme, authority: root.authority }),
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
      onDidGrantWorkspaceTrust: registerTrustChange,
      createProposeFileEditWorkspace: () =>
        ({
          captureFileRevision: async () => ({
            uri: "file:///workspace/file.ts",
            revision: { kind: "document_version", value: 1 },
          }),
          isFileRevisionCurrent: async () => true,
        }) satisfies ProposeFileEditWorkspace,
      commandExecutor: {
        run: async () => ({
          output: { stdout: "", stderr: "", exitCode: 0, signal: null },
          truncated: false,
        }),
      },
      workspaceTrust: {
        isTrusted: () => trusted,
        requireTrusted() {
          if (!trusted) {
            throw new Error("Workspace is not trusted.");
          }
        },
      },
      editorContext: overrides.editorContext,
      diagnostics: overrides.diagnostics,
      languageServices: overrides.languageServices,
    },
    joinPath,
    registerWorkspaceChange,
    disposeWorkspaceChange,
    disposeTrustChange,
    emitWorkspaceChange: () => workspaceChangeListener?.(),
    emitTrustGrant: () => trustChangeListener?.(),
    setTrusted(value: boolean) {
      trusted = value;
    },
  };
}
