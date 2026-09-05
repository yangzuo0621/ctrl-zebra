import { DiagnosticsUnavailableError } from "@ctrl-zebra/builtin-tools";
import {
  maxIdeDiagnosticAggregateBytes,
  maxIdeDiagnosticAggregateCodePoints,
  maxIdeDiagnosticEntries,
  maxIdeDiagnosticMessageCodePoints,
  maxIdeLanguageIdBytes,
  utf8ByteLength,
} from "@ctrl-zebra/protocol";
import { describe, expect, it, vi } from "vitest";
import type { Diagnostic, TextDocument, TextEditor, Uri } from "vscode";

import { createTestUri as uri } from "../test/support/test-uri.js";
import { VsCodeDiagnostics } from "./vscode-diagnostics.js";
import { WorkspaceScope } from "./workspace-scope.js";

describe("VsCodeDiagnostics", () => {
  it("projects active-file diagnostics with bounded source provenance", async () => {
    const document = createDocument("const answer = 42;", "/workspace/src/index.ts");
    const editor = createEditor(document);
    const provider = vi.fn(() => [diagnostic(0, 6, 0, 12, 0, "unused", "E1", "typescript")]);
    const adapter = createAdapter(editor, provider);

    await expect(adapter.getDiagnostics({ scope: "active-file" }, signal())).resolves.toMatchObject(
      {
        kind: "diagnostics",
        stale: false,
        truncated: false,
        diagnostics: [
          {
            source: {
              uri: { scheme: "file", authority: "", path: "src/index.ts" },
              range: {
                start: { line: 0, character: 6 },
                end: { line: 0, character: 12 },
              },
            },
            severity: "error",
            message: "unused",
            code: "E1",
            origin: "typescript",
          },
        ],
      },
    );
    expect(provider).toHaveBeenCalledWith(document.uri);
  });

  it("returns an empty workspace result and supports one workspace-relative path", async () => {
    const document = createDocument("text", "/workspace/src/index.ts");
    const provider = vi.fn((uri?: Uri) => (uri === undefined ? [] : []));
    const adapter = createAdapter(undefined, provider, { document });

    await expect(adapter.getDiagnostics({ scope: "workspace" }, signal())).resolves.toMatchObject({
      kind: "diagnostics",
      diagnostics: [],
      truncated: false,
    });
    await expect(
      adapter.getDiagnostics({ scope: "workspace", path: "src/index.ts" }, signal()),
    ).resolves.toMatchObject({ diagnostics: [], source: { uri: { path: "src/index.ts" } } });
    expect(provider).toHaveBeenLastCalledWith(document.uri);
  });

  it("filters outside workspace resources and marks a mixed response truncated", async () => {
    const inside = uri("/workspace/src/index.ts");
    const outside = uri("/other/secret.ts");
    const document = createDocument("text", inside.path);
    const provider = vi.fn(
      () =>
        [
          [outside, [diagnostic(0, 0, 0, 1, 1, "secret")]],
          [inside, [diagnostic(0, 0, 0, 1, 1, "warning")]],
        ] as const,
    );
    const result = await createAdapter(undefined, provider, { document }).getDiagnostics(
      { scope: "workspace" },
      signal(),
    );

    expect(result).toMatchObject({
      diagnostics: [{ source: { uri: { path: "src/index.ts" } }, severity: "warning" }],
      truncated: true,
      truncationReasons: ["out-of-workspace"],
    });
  });

  it("rejects all-outside and malformed untrusted provider diagnostics", async () => {
    const outside = uri("/other/secret.ts");
    await expect(
      createAdapter(
        undefined,
        () => [[outside, [diagnostic(0, 0, 0, 1, 0, "secret")]]] as const,
      ).getDiagnostics({ scope: "workspace" }, signal()),
    ).rejects.toThrow("Diagnostics returned invalid output.");

    const document = createDocument("text", "/workspace/src/index.ts");
    await expect(
      createAdapter(
        createEditor(document),
        () => [diagnostic(0, 0, 0, 1, 8, "bad severity")] as const,
      ).getDiagnostics({ scope: "active-file" }, signal()),
    ).rejects.toThrow("Diagnostics returned invalid output.");
  });

  it("bounds messages and entry count without constructing an unbounded DTO", async () => {
    const large = "x".repeat(maxIdeDiagnosticMessageCodePoints + 1);
    const document = createDocument("x", "/workspace/src/index.ts");
    const exact = vi.fn(() =>
      Array.from({ length: maxIdeDiagnosticEntries }, (_, index) =>
        diagnostic(0, 0, 0, 1, 2, `small-${index}`),
      ),
    );
    const exactResult = await createAdapter(createEditor(document), exact).getDiagnostics(
      { scope: "active-file" },
      signal(),
    );

    expect(exactResult.diagnostics).toHaveLength(maxIdeDiagnosticEntries);
    expect(exactResult.truncated).toBe(false);

    const overflow = vi.fn(() =>
      Array.from({ length: maxIdeDiagnosticEntries + 1 }, (_, index) =>
        diagnostic(0, 0, 0, 1, 2, `small-${index}`),
      ),
    );
    const overflowResult = await createAdapter(createEditor(document), overflow).getDiagnostics(
      { scope: "active-file" },
      signal(),
    );
    expect(overflowResult.diagnostics).toHaveLength(maxIdeDiagnosticEntries);
    expect(overflowResult.truncated).toBe(true);
    expect(overflowResult.truncationReasons).toContain("entries");

    const largeResult = await createAdapter(createEditor(document), () => [
      diagnostic(0, 0, 0, 1, 2, large),
    ]).getDiagnostics({ scope: "active-file" }, signal());
    expect(largeResult.diagnostics[0]?.message).toHaveLength(maxIdeDiagnosticMessageCodePoints);
    expect(largeResult.truncationReasons).toContain("code-points");

    const aggregateResult = await createAdapter(createEditor(document), () =>
      Array.from({ length: 40 }, () => diagnostic(0, 0, 0, 1, 2, large)),
    ).getDiagnostics({ scope: "active-file" }, signal());
    expect(aggregateResult.truncated).toBe(true);
    expect(aggregateResult.truncationReasons).toContain("code-points");
    expect(aggregateResult.truncationReasons).not.toContain("entries");
  });

  it("sorts diagnostics deterministically and removes exact duplicates before the entry prefix", async () => {
    const document = createDocument("text", "/workspace/src/index.ts");
    const first = diagnostic(0, 0, 0, 1, 2, "alpha");
    const second = diagnostic(0, 0, 0, 1, 2, "zulu");
    const result = await createAdapter(
      createEditor(document),
      () => [second, first, first] as const,
    ).getDiagnostics({ scope: "active-file" }, signal());

    expect(result.diagnostics.map(({ message }) => message)).toEqual(["alpha", "zulu"]);
    expect(result.truncated).toBe(false);
  });

  it("deduplicates a duplicate flood before aggregate accounting", async () => {
    const document = createDocument("x", "/workspace/src/index.ts");
    const repeated = diagnostic(0, 0, 0, 1, 2, "x".repeat(maxIdeDiagnosticMessageCodePoints));
    const result = await createAdapter(createEditor(document), () =>
      Array.from({ length: 128 }, () => repeated),
    ).getDiagnostics({ scope: "active-file" }, signal());

    expect(result.diagnostics).toHaveLength(1);
    expect(result.truncated).toBe(false);
  });

  it("keeps aggregate truncation and the accepted prefix independent of provider order", async () => {
    const document = createDocument("x", "/workspace/src/index.ts");
    const diagnostics = Array.from({ length: 40 }, (_, index) =>
      diagnostic(
        0,
        0,
        0,
        1,
        2,
        `${String(index).padStart(4, "0")}${"x".repeat(maxIdeDiagnosticMessageCodePoints - 4)}`,
      ),
    );
    const forward = await createAdapter(createEditor(document), () => diagnostics).getDiagnostics(
      { scope: "active-file" },
      signal(),
    );
    const reverse = await createAdapter(createEditor(document), () =>
      [...diagnostics].reverse(),
    ).getDiagnostics({ scope: "active-file" }, signal());

    expect(forward.diagnostics).toEqual(reverse.diagnostics);
    expect(forward.diagnostics.length).toBeLessThan(diagnostics.length);
    expect(forward.truncated).toBe(true);
    expect(forward.truncationReasons).toContain("code-points");
    expect(forward.diagnostics.length).toBeLessThanOrEqual(
      Math.floor(maxIdeDiagnosticAggregateCodePoints / maxIdeDiagnosticMessageCodePoints),
    );
  });

  it("counts the top-level source at the aggregate boundary", async () => {
    const count = 32;
    const sourceCodePoints = ["file", "", "src/index.ts", "typescript"].reduce(
      (total, value) => total + [...value].length,
      0,
    );
    const finalMessageCodePoints =
      maxIdeDiagnosticAggregateCodePoints -
      sourceCodePoints * (count + 1) -
      (count - 1) * maxIdeDiagnosticMessageCodePoints;
    const document = createDocument(
      Array.from({ length: count }, () => "x").join("\n"),
      "/workspace/src/index.ts",
    );
    const exact = Array.from({ length: count }, (_, index) =>
      diagnostic(
        index,
        0,
        index,
        1,
        2,
        index === count - 1
          ? "😀".repeat(finalMessageCodePoints)
          : "😀".repeat(maxIdeDiagnosticMessageCodePoints),
      ),
    );
    const exactResult = await createAdapter(createEditor(document), () => exact).getDiagnostics(
      { scope: "active-file" },
      signal(),
    );
    expect(exactResult.diagnostics).toHaveLength(count);
    expect(exactResult.truncated).toBe(false);

    const sourceBytes = ["file", "", "src/index.ts", "typescript"].reduce(
      (total, value) => total + utf8ByteLength(value),
      0,
    );
    const exactBytes =
      sourceBytes * (count + 1) +
      ((count - 1) * maxIdeDiagnosticMessageCodePoints + finalMessageCodePoints) * 4;
    const oneOverAstrals = Math.floor((maxIdeDiagnosticAggregateBytes - exactBytes) / 4) + 1;
    const oneOver = exact.map((value, index) =>
      index === count - 1
        ? { ...value, message: `${value.message}${"😀".repeat(oneOverAstrals)}` }
        : value,
    );
    const oneOverResult = await createAdapter(createEditor(document), () => oneOver).getDiagnostics(
      { scope: "active-file" },
      signal(),
    );
    expect(oneOverResult.diagnostics).toHaveLength(count - 1);
    expect(oneOverResult.truncated).toBe(true);
    expect(oneOverResult.truncationReasons).toEqual(
      expect.arrayContaining(["code-points", "utf8-bytes"]),
    );
    expect(maxIdeDiagnosticAggregateBytes).toBe(maxIdeDiagnosticAggregateCodePoints * 4);
  });

  it("rejects ranges from a closed file when the host cannot verify document bounds", async () => {
    await expect(
      createAdapter(undefined, () => [diagnostic(0, 0, 0, 1, 2, "closed")]).getDiagnostics(
        { scope: "workspace", path: "src/index.ts" },
        signal(),
      ),
    ).rejects.toThrow("Diagnostics returned invalid output.");
  });

  it("rejects an oversized astral language id instead of silently prefixing it", async () => {
    const atByteLimit = "😀".repeat(maxIdeLanguageIdBytes / 4);
    const exactDocument = createDocument("x", "/workspace/src/index.ts", atByteLimit);
    const exact = await createAdapter(createEditor(exactDocument), () => [
      diagnostic(0, 0, 0, 1, 2, "exact"),
    ]).getDiagnostics({ scope: "active-file" }, signal());
    expect(exact.diagnostics[0]?.source.languageId).toBe(atByteLimit);

    const oversizedDocument = createDocument("x", "/workspace/src/index.ts", `${atByteLimit}😀`);
    await expect(
      createAdapter(createEditor(oversizedDocument), () => [
        diagnostic(0, 0, 0, 1, 2, "over"),
      ]).getDiagnostics({ scope: "active-file" }, signal()),
    ).rejects.toThrow("Diagnostics returned invalid output.");
  });

  it("accepts only the exact DiagnosticCode object shape and never projects its target URI", async () => {
    const document = createDocument("text", "/workspace/src/index.ts");
    const target = uri("/workspace/docs/rule");
    const valid = {
      ...diagnostic(0, 0, 0, 1, 2, "valid"),
      code: { target, value: "E1" },
    } as unknown as Diagnostic;
    const result = await createAdapter(createEditor(document), () => [valid]).getDiagnostics(
      { scope: "active-file" },
      signal(),
    );
    expect(result.diagnostics[0]?.code).toBe("E1");
    expect(JSON.stringify(result)).not.toContain(target.path);

    const malformed = {
      ...valid,
      code: { target, value: "E1", extra: true },
    } as unknown as Diagnostic;
    await expect(
      createAdapter(createEditor(document), () => [malformed]).getDiagnostics(
        { scope: "active-file" },
        signal(),
      ),
    ).rejects.toThrow("Diagnostics returned invalid output.");
  });

  it("marks a document version change stale while rejecting cancellation and disposal races", async () => {
    const document = createDocument("text", "/workspace/src/index.ts");
    const editor = createEditor(document);
    let release: (() => void) | undefined;
    const provider = vi.fn(
      () =>
        new Promise<readonly Diagnostic[]>((resolve) => {
          release = () => resolve([diagnostic(0, 0, 0, 1, 3, "hint")]);
        }),
    );
    const adapter = createAdapter(editor, provider);
    const pending = adapter.getDiagnostics({ scope: "active-file" }, signal());
    await vi.waitFor(() => expect(release).toBeDefined());
    Object.defineProperty(document, "version", { value: 2, configurable: true });
    release?.();
    await expect(pending).resolves.toMatchObject({ stale: true });

    let cancelRelease: (() => void) | undefined;
    const cancelProvider = vi.fn(
      () =>
        new Promise<readonly Diagnostic[]>((resolve) => {
          cancelRelease = () => resolve([]);
        }),
    );
    const controller = new AbortController();
    const cancellation = new Error("cancel diagnostics");
    const cancelled = createAdapter(editor, cancelProvider).getDiagnostics(
      { scope: "active-file" },
      controller.signal,
    );
    await vi.waitFor(() => expect(cancelRelease).toBeDefined());
    controller.abort(cancellation);
    cancelRelease?.();
    await expect(cancelled).rejects.toBe(cancellation);

    let disposeRelease: (() => void) | undefined;
    const disposeProvider = vi.fn(
      () =>
        new Promise<readonly Diagnostic[]>((resolve) => {
          disposeRelease = () => resolve([]);
        }),
    );
    const disposed = createAdapter(editor, disposeProvider);
    const late = disposed.getDiagnostics({ scope: "active-file" }, signal());
    await vi.waitFor(() => expect(disposeRelease).toBeDefined());
    disposed.dispose();
    disposeRelease?.();
    await expect(late).rejects.toEqual(new DiagnosticsUnavailableError());
  });

  it("rejects a result when disposal races asynchronous URI canonicalization", async () => {
    const inside = uri("/workspace/src/index.ts");
    let release: (() => void) | undefined;
    let validations = 0;
    const validate = vi.fn(async (target: Uri) => {
      validations += 1;
      if (validations === 2) {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      return target;
    });
    const adapter = createAdapter(
      undefined,
      () => [[inside, [diagnostic(0, 0, 0, 1, 2, "late")]]],
      {
        document: createDocument("text", inside.path),
        validate,
      },
    );
    const pending = adapter.getDiagnostics({ scope: "workspace" }, signal());
    await vi.waitFor(() => expect(release).toBeDefined());
    adapter.dispose();
    release?.();
    await expect(pending).rejects.toEqual(new DiagnosticsUnavailableError());
  });
});

function createAdapter(
  editor: TextEditor | undefined,
  provider: (
    uri?: Uri,
  ) =>
    | readonly Diagnostic[]
    | readonly (readonly [Uri, readonly Diagnostic[]])[]
    | Promise<readonly Diagnostic[] | readonly (readonly [Uri, readonly Diagnostic[]])[]>,
  overrides: {
    readonly document?: TextDocument;
    readonly validate?: (target: Uri, signal: AbortSignal) => Promise<Uri>;
  } = {},
): VsCodeDiagnostics {
  const root = uri("/workspace");
  const document = overrides.document ?? editor?.document;
  return new VsCodeDiagnostics({
    getActiveEditor: () => editor,
    getSelectedRoot: () => root,
    createScope: () =>
      new WorkspaceScope(root, overrides.validate ?? (async (target) => target), {
        caseSensitivePaths: true,
      }),
    joinPath: (base, path) => uri(`${base.path}/${path}`),
    getDiagnostics: provider,
    getDocument: () => document,
    isEnabled: () => true,
    isTrusted: () => true,
  });
}

function createDocument(text: string, path: string, languageId = "typescript"): TextDocument {
  let version = 1;
  const lines = text.split(/\r\n|\n/u);
  return {
    uri: uri(path),
    get version() {
      return version;
    },
    set version(value: number) {
      version = value;
    },
    languageId,
    lineCount: lines.length,
    lineAt: (line: number) => ({ text: lines[line] ?? "" }),
  } as unknown as TextDocument;
}

function createEditor(document: TextDocument): TextEditor {
  return { document } as unknown as TextEditor;
}

function diagnostic(
  startLine: number,
  startCharacter: number,
  endLine: number,
  endCharacter: number,
  severity: number,
  message: string,
  code?: string,
  source?: string,
): Diagnostic {
  return {
    range: {
      start: { line: startLine, character: startCharacter },
      end: { line: endLine, character: endCharacter },
    },
    severity,
    message,
    ...(code === undefined ? {} : { code }),
    ...(source === undefined ? {} : { source }),
  } as unknown as Diagnostic;
}

function signal(): AbortSignal {
  return new AbortController().signal;
}
