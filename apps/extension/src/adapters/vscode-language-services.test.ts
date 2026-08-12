import { LanguageServiceUnavailableError } from "@ctrl-zebra/builtin-tools";
import { maxIdeDiagnosticLabelCodePoints, maxIdeSymbolEntries } from "@ctrl-zebra/protocol";
import { describe, expect, it, vi } from "vitest";
import type { TextDocument, Uri } from "vscode";

import {
  InvalidLanguageServiceOutputError,
  VsCodeLanguageServices,
} from "./vscode-language-services.js";
import { WorkspaceScope } from "./workspace-scope.js";

describe("VsCodeLanguageServices", () => {
  it("calls the definition provider with a validated target and projects multiple locations", async () => {
    const document = createDocument("const answer = 42;", "/workspace/src/index.ts");
    const provider = vi.fn(async () => [
      location(uri("/workspace/src/index.ts"), 0, 6, 0, 12),
      location(uri("/workspace/src/other.ts"), 0, 0, 0, 6),
    ]);
    const adapter = createAdapter({
      documents: [document, createDocument("answer", "/workspace/src/other.ts")],
      executeDefinitionProvider: provider,
    });

    await expect(
      adapter.findDefinition(
        { path: "src/index.ts", position: { line: 0, character: 7 } },
        signal(),
      ),
    ).resolves.toMatchObject({
      operation: "definition",
      source: { uri: { path: "src/index.ts" } },
      locations: [
        { source: { uri: { path: "src/index.ts" } }, kind: "definition" },
        { source: { uri: { path: "src/other.ts" } }, kind: "definition" },
      ],
    });
    expect(provider).toHaveBeenCalledWith(
      document.uri,
      { line: 0, character: 7 },
      expect.any(AbortSignal),
    );
  });

  it("sorts locations deterministically and removes exact provider duplicates", async () => {
    const document = createDocument("answer", "/workspace/src/index.ts");
    const other = createDocument("answer", "/workspace/src/other.ts");
    const result = await createAdapter({
      documents: [document, other],
      executeReferenceProvider: async () => [
        location(other.uri, 0, 0, 0, 1),
        location(document.uri, 0, 0, 0, 1),
        location(document.uri, 0, 0, 0, 1),
      ],
    }).findReferences({ path: "src/index.ts", position: { line: 0, character: 0 } }, signal());

    expect(result.locations).toHaveLength(2);
    expect(result.locations.map(({ source }) => source.uri.path)).toEqual([
      "src/index.ts",
      "src/other.ts",
    ]);
  });

  it("returns empty results, marks mixed outside results, and rejects all-outside results", async () => {
    const document = createDocument("answer", "/workspace/src/index.ts");
    const empty = createAdapter({
      documents: [document],
      executeReferenceProvider: async () => [],
    });
    await expect(
      empty.findReferences({ path: "src/index.ts", position: { line: 0, character: 0 } }, signal()),
    ).resolves.toMatchObject({ locations: [], truncated: false });

    const mixed = createAdapter({
      documents: [document],
      executeReferenceProvider: async () => [
        location(uri("/other/secret.ts"), 0, 0, 0, 1),
        location(document.uri, 0, 0, 0, 3),
      ],
    });
    await expect(
      mixed.findReferences({ path: "src/index.ts", position: { line: 0, character: 0 } }, signal()),
    ).resolves.toMatchObject({
      locations: [{ source: { uri: { path: "src/index.ts" } } }],
      truncated: true,
      truncationReasons: ["out-of-workspace"],
    });

    const outside = createAdapter({
      documents: [document],
      executeReferenceProvider: async () => [location(uri("/other/secret.ts"), 0, 0, 0, 1)],
    });
    await expect(
      outside.findReferences(
        { path: "src/index.ts", position: { line: 0, character: 0 } },
        signal(),
      ),
    ).rejects.toEqual(new InvalidLanguageServiceOutputError());
  });

  it("rejects malformed outside location and LocationLink ranges before filtering", async () => {
    const document = createDocument("answer", "/workspace/src/index.ts");
    const malformedLocation = createAdapter({
      documents: [document],
      executeDefinitionProvider: async () => [
        location(uri("/other/secret.ts"), 0, 3, 0, 1),
        location(document.uri, 0, 0, 0, 1),
      ],
    });
    await expect(
      malformedLocation.findDefinition(
        { path: "src/index.ts", position: { line: 0, character: 0 } },
        signal(),
      ),
    ).rejects.toEqual(new InvalidLanguageServiceOutputError());

    const malformedLink = createAdapter({
      documents: [document],
      executeDefinitionProvider: async () => [
        {
          targetUri: uri("/other/secret.ts"),
          targetRange: rangeValue(0, 3, 0, 1),
        },
        location(document.uri, 0, 0, 0, 1),
      ],
    });
    await expect(
      malformedLink.findDefinition(
        { path: "src/index.ts", position: { line: 0, character: 0 } },
        signal(),
      ),
    ).rejects.toEqual(new InvalidLanguageServiceOutputError());
  });

  it("rejects malformed ranges and maps missing providers to unavailable", async () => {
    const document = createDocument("answer", "/workspace/src/index.ts");
    const malformed = createAdapter({
      documents: [document],
      executeDefinitionProvider: async () => [
        {
          uri: document.uri,
          range: { start: { line: 0, character: 3 }, end: { line: 0, character: 1 } },
        },
      ],
    });
    await expect(
      malformed.findDefinition(
        { path: "src/index.ts", position: { line: 0, character: 0 } },
        signal(),
      ),
    ).rejects.toEqual(new InvalidLanguageServiceOutputError());

    const unavailable = createAdapter({
      documents: [document],
      executeDefinitionProvider: async () => undefined,
    });
    await expect(
      unavailable.findDefinition(
        { path: "src/index.ts", position: { line: 0, character: 0 } },
        signal(),
      ),
    ).rejects.toEqual(new LanguageServiceUnavailableError());

    const invalidProvider = createAdapter({
      documents: [document],
      executeDefinitionProvider: async () => {
        throw new InvalidLanguageServiceOutputError();
      },
    });
    await expect(
      invalidProvider.findDefinition(
        { path: "src/index.ts", position: { line: 0, character: 0 } },
        signal(),
      ),
    ).rejects.toEqual(new InvalidLanguageServiceOutputError());
  });

  it("preserves valid UTF-16 boundaries and rejects split-surrogate or out-of-line positions", async () => {
    const document = createDocument("😀x", "/workspace/src/index.ts");
    const adapter = createAdapter({
      documents: [document],
      executeDefinitionProvider: async () => [location(document.uri, 0, 2, 0, 3)],
    });

    await expect(
      adapter.findDefinition(
        { path: "src/index.ts", position: { line: 0, character: 2 } },
        signal(),
      ),
    ).resolves.toMatchObject({ locations: [{ range: { start: { character: 2 } } }] });
    await expect(
      adapter.findDefinition(
        { path: "src/index.ts", position: { line: 0, character: 1 } },
        signal(),
      ),
    ).rejects.toEqual(new InvalidLanguageServiceOutputError());
    await expect(
      adapter.findDefinition(
        { path: "src/index.ts", position: { line: 0, character: 4 } },
        signal(),
      ),
    ).rejects.toEqual(new InvalidLanguageServiceOutputError());
  });

  it("flattens DocumentSymbol trees and maps SymbolInformation kinds", async () => {
    const document = createDocument("class Foo {\n  method() {}\n}", "/workspace/src/index.ts");
    const provider = vi.fn(async () => [
      {
        name: "Foo",
        kind: 4,
        range: rangeValue(0, 0, 2, 1),
        selectionRange: rangeValue(0, 6, 0, 9),
        detail: "class",
        children: [
          {
            name: "method",
            kind: 5,
            range: rangeValue(1, 2, 1, 12),
          },
        ],
      },
      {
        name: "unknown",
        kind: 999,
        location: { uri: document.uri, range: rangeValue(1, 2, 1, 8) },
        containerName: "Foo",
      },
    ]);
    const adapter = createAdapter({
      documents: [document],
      executeDocumentSymbolProvider: provider,
    });

    await expect(adapter.listSymbols({ path: "src/index.ts" }, signal())).resolves.toMatchObject({
      symbols: [
        { name: "Foo", kind: "class", detail: "class", selectionRange: expect.any(Object) },
        { name: "method", kind: "method", containerName: "Foo" },
        { name: "unknown", kind: "unknown", containerName: "Foo" },
      ],
    });
  });

  it("maps string symbol kinds through the closed conceptual labels", async () => {
    const document = createDocument("x", "/workspace/src/index.ts");
    const result = await createAdapter({
      documents: [document],
      executeDocumentSymbolProvider: async () => [
        { name: "one", kind: "EnumMember", range: rangeValue(0, 0, 0, 1) },
        { name: "two", kind: "TYPE_PARAMETER", range: rangeValue(0, 0, 0, 1) },
      ],
    }).listSymbols({ path: "src/index.ts" }, signal());

    expect(result.symbols.map(({ kind }) => kind)).toEqual(["enum-member", "type-parameter"]);
  });

  it("rejects SymbolInformation that points at a different in-workspace document", async () => {
    const document = createDocument("x", "/workspace/src/index.ts");
    const other = createDocument("x", "/workspace/src/other.ts");
    const adapter = createAdapter({
      documents: [document, other],
      executeDocumentSymbolProvider: async () => [
        {
          name: "other",
          kind: 12,
          location: { uri: other.uri, range: rangeValue(0, 0, 0, 1) },
        },
      ],
    });

    await expect(adapter.listSymbols({ path: "src/index.ts" }, signal())).rejects.toEqual(
      new InvalidLanguageServiceOutputError(),
    );
  });

  it("rejects malformed outside SymbolInformation ranges before filtering", async () => {
    const document = createDocument("x", "/workspace/src/index.ts");
    const adapter = createAdapter({
      documents: [document],
      executeDocumentSymbolProvider: async () => [
        {
          name: "outside",
          kind: 12,
          location: { uri: uri("/other/secret.ts"), range: rangeValue(0, 1, 0, 0) },
        },
        { name: "valid", kind: 12, range: rangeValue(0, 0, 0, 1) },
      ],
    });

    await expect(adapter.listSymbols({ path: "src/index.ts" }, signal())).rejects.toEqual(
      new InvalidLanguageServiceOutputError(),
    );
  });

  it("deduplicates repeated symbols while retaining deterministic source order", async () => {
    const document = createDocument("x", "/workspace/src/index.ts");
    const repeated = {
      name: "answer",
      kind: 12,
      range: rangeValue(0, 0, 0, 1),
    };
    const zulu = {
      name: "zulu",
      kind: 12,
      range: rangeValue(0, 0, 0, 1),
    };
    const result = await createAdapter({
      documents: [document],
      executeDocumentSymbolProvider: async () => [zulu, repeated, repeated],
    }).listSymbols({ path: "src/index.ts" }, signal());

    expect(result.symbols.map(({ name }) => name)).toEqual(["answer", "zulu"]);
  });

  it("bounds symbol labels and entries while preserving closed unknown kinds", async () => {
    const document = createDocument("x", "/workspace/src/index.ts");
    const provider = vi.fn(async () =>
      Array.from({ length: maxIdeSymbolEntries + 1 }, (_, index) => ({
        name: index === 0 ? `a${"😀".repeat(maxIdeDiagnosticLabelCodePoints)}` : `s-${index}`,
        kind: 999,
        range: rangeValue(0, 0, 0, 1),
      })),
    );
    const result = await createAdapter({
      documents: [document],
      executeDocumentSymbolProvider: provider,
    }).listSymbols({ path: "src/index.ts" }, signal());
    expect(result.symbols).toHaveLength(maxIdeSymbolEntries);
    const bounded = result.symbols.find(
      ({ name }) => Array.from(name).length === maxIdeDiagnosticLabelCodePoints,
    );
    expect(bounded?.kind).toBe("unknown");
    expect(result.truncated).toBe(true);
    expect(result.truncationReasons).toEqual(["code-points", "utf8-bytes", "entries"]);
  });

  it("bounds deep and massive DocumentSymbol traversal with deterministic entry truncation", async () => {
    const document = createDocument("x", "/workspace/src/index.ts");
    const deepRoot: Record<string, unknown> = {
      name: "depth-0",
      kind: 12,
      range: rangeValue(0, 0, 0, 1),
    };
    let current = deepRoot;
    for (let depth = 1; depth < 600; depth += 1) {
      const child = {
        name: `depth-${depth}`,
        kind: 12,
        range: rangeValue(0, 0, 0, 1),
      };
      current.children = [child];
      current = child;
    }
    const massive = Array.from({ length: 16_385 }, (_, index) => ({
      name: `massive-${index}`,
      kind: 12,
      range: rangeValue(0, 0, 0, 1),
    }));
    const result = await createAdapter({
      documents: [document],
      executeDocumentSymbolProvider: async () => [deepRoot, ...massive],
    }).listSymbols({ path: "src/index.ts" }, signal());

    expect(result.symbols).toHaveLength(maxIdeSymbolEntries);
    expect(result.truncated).toBe(true);
    expect(result.truncationReasons).toContain("entries");
  });

  it("rejects cyclic DocumentSymbol trees instead of recursing indefinitely", async () => {
    const document = createDocument("x", "/workspace/src/index.ts");
    const cyclic: Record<string, unknown> = {
      name: "cycle",
      kind: 12,
      range: rangeValue(0, 0, 0, 1),
    };
    cyclic.children = [cyclic];
    const adapter = createAdapter({
      documents: [document],
      executeDocumentSymbolProvider: async () => [cyclic],
    });

    await expect(adapter.listSymbols({ path: "src/index.ts" }, signal())).rejects.toEqual(
      new InvalidLanguageServiceOutputError(),
    );
  });

  it("stops traversal promptly when cancellation closes the provider gate", async () => {
    const document = createDocument("x", "/workspace/src/index.ts");
    const controller = new AbortController();
    let validations = 0;
    const adapter = createAdapter({
      documents: [document],
      canonicalize: async (target, signal) => {
        validations += 1;
        if (validations > 4) controller.abort(new Error("cancel traversal"));
        signal.throwIfAborted();
        return target;
      },
      executeDocumentSymbolProvider: async () =>
        Array.from({ length: 32 }, (_, index) => ({
          name: `symbol-${index}`,
          kind: 12,
          location: { uri: document.uri, range: rangeValue(0, 0, 0, 1) },
        })),
    });

    await expect(adapter.listSymbols({ path: "src/index.ts" }, controller.signal)).rejects.toThrow(
      "cancel traversal",
    );
  });

  it("keeps stale results visible but suppresses cancelled and disposed late results", async () => {
    const document = createDocument("answer", "/workspace/src/index.ts");
    let release: (() => void) | undefined;
    const pendingProvider = vi.fn(
      () =>
        new Promise<readonly unknown[]>((resolve) => {
          release = () => resolve([]);
        }),
    );
    const adapter = createAdapter({
      documents: [document],
      executeReferenceProvider: pendingProvider,
    });
    const stale = adapter.findReferences(
      { path: "src/index.ts", position: { line: 0, character: 0 } },
      signal(),
    );
    await vi.waitFor(() => expect(release).toBeDefined());
    Object.defineProperty(document, "version", { value: 2, configurable: true });
    release?.();
    await expect(stale).resolves.toMatchObject({ stale: true });

    let cancelRelease: (() => void) | undefined;
    const cancelledController = new AbortController();
    const cancelled = createAdapter({
      documents: [document],
      executeReferenceProvider: () =>
        new Promise<readonly unknown[]>((resolve) => {
          cancelRelease = () => resolve([]);
        }),
    }).findReferences(
      { path: "src/index.ts", position: { line: 0, character: 0 } },
      cancelledController.signal,
    );
    await vi.waitFor(() => expect(cancelRelease).toBeDefined());
    const cancellation = new Error("cancel language query");
    cancelledController.abort(cancellation);
    cancelRelease?.();
    await expect(cancelled).rejects.toBe(cancellation);

    const disposeAdapter = createAdapter({
      documents: [document],
      executeReferenceProvider: pendingProvider,
    });
    let disposeRelease: (() => void) | undefined;
    const disposedPending = createAdapter({
      documents: [document],
      executeReferenceProvider: () =>
        new Promise<readonly unknown[]>((resolve) => {
          disposeRelease = () => resolve([]);
        }),
    });
    const late = disposedPending.findReferences(
      { path: "src/index.ts", position: { line: 0, character: 0 } },
      signal(),
    );
    await vi.waitFor(() => expect(disposeRelease).toBeDefined());
    disposedPending.dispose();
    disposeRelease?.();
    await expect(late).rejects.toEqual(new LanguageServiceUnavailableError());
    disposeAdapter.dispose();
  });
});

function createAdapter(options: {
  readonly documents: readonly TextDocument[];
  readonly canonicalize?: (target: Uri, signal: AbortSignal) => Promise<Uri>;
  readonly executeDefinitionProvider?: (
    uri: Uri,
    position: unknown,
    signal: AbortSignal,
  ) => Promise<unknown>;
  readonly executeReferenceProvider?: (
    uri: Uri,
    position: unknown,
    signal: AbortSignal,
  ) => Promise<unknown>;
  readonly executeDocumentSymbolProvider?: (uri: Uri, signal: AbortSignal) => Promise<unknown>;
}): VsCodeLanguageServices {
  const root = uri("/workspace");
  const documents = new Map(
    options.documents.map((document) => [document.uri.toString(), document]),
  );
  return new VsCodeLanguageServices({
    getSelectedRoot: () => root,
    createScope: () =>
      new WorkspaceScope(root, options.canonicalize ?? (async (target) => target), {
        caseSensitivePaths: true,
      }),
    joinPath: (base, path) => uri(`${base.path}/${path}`),
    getDocument: (target) => documents.get(target.toString()),
    executeDefinitionProvider: options.executeDefinitionProvider ?? (async () => []),
    executeReferenceProvider: options.executeReferenceProvider ?? (async () => []),
    executeDocumentSymbolProvider: options.executeDocumentSymbolProvider ?? (async () => []),
    isEnabled: () => true,
    isTrusted: () => true,
  });
}

function createDocument(text: string, path: string): TextDocument {
  const lines = text.split(/\r\n|\n/u);
  return {
    uri: uri(path),
    version: 1,
    languageId: "typescript",
    lineCount: lines.length,
    lineAt: (line: number) => ({ text: lines[line] ?? "" }),
  } as unknown as TextDocument;
}

function location(
  uriValue: Uri,
  startLine: number,
  startCharacter: number,
  endLine: number,
  endCharacter: number,
) {
  return {
    uri: uriValue,
    range: rangeValue(startLine, startCharacter, endLine, endCharacter),
  };
}

function rangeValue(
  startLine: number,
  startCharacter: number,
  endLine: number,
  endCharacter: number,
) {
  return {
    start: { line: startLine, character: startCharacter },
    end: { line: endLine, character: endCharacter },
  };
}

class TestUri implements Uri {
  readonly scheme = "file";
  readonly authority = "";
  readonly query = "";
  readonly fragment = "";

  constructor(readonly path: string) {}

  get fsPath(): string {
    return this.path;
  }

  with(change: { path?: string }): Uri {
    return new TestUri(change.path ?? this.path);
  }

  toString(): string {
    return `file://${this.path}`;
  }

  toJSON(): unknown {
    return { scheme: this.scheme, authority: this.authority, path: this.path };
  }
}

function uri(path: string): Uri {
  return new TestUri(path);
}

function signal(): AbortSignal {
  return new AbortController().signal;
}
