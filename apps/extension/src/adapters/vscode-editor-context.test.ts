import { EditorContextUnavailableError } from "@ctrl-zebra/builtin-tools";
import { maxIdeTextCodePoints, maxIdeTextLines } from "@ctrl-zebra/protocol";
import { describe, expect, it, vi } from "vitest";
import type { TextDocument, TextEditor, TextLine, Uri } from "vscode";

import { VsCodeEditorContext } from "./vscode-editor-context.js";
import { WorkspaceScope } from "./workspace-scope.js";

type Validate = (target: Uri, signal: AbortSignal) => Promise<Uri>;

describe("VsCodeEditorContext", () => {
  it("projects the active document with a redacted workspace-relative URI", async () => {
    const document = createDocument("const answer = 42;", "/workspace/src/index.ts");
    const editor = createEditor(document, position(0, 0), position(0, 6));
    const adapter = createAdapter(editor);

    await expect(adapter.readEditorContext({ scope: "active-editor" }, signal())).resolves.toEqual(
      expect.objectContaining({
        source: expect.objectContaining({
          uri: { scheme: "file", authority: "", path: "src/index.ts" },
          languageId: "typescript",
          documentVersion: 1,
          stale: false,
          truncated: false,
        }),
        text: "const answer = 42;",
      }),
    );
  });

  it("returns the exact collapsed selection as an empty snapshot", async () => {
    const document = createDocument("const answer = 42;", "/workspace/src/index.ts");
    const editor = createEditor(document, position(0, 6), position(0, 6));
    const result = await createAdapter(editor).readEditorContext({ scope: "selection" }, signal());

    expect(result).toEqual({
      source: expect.objectContaining({
        range: {
          start: { line: 0, character: 6 },
          end: { line: 0, character: 6 },
        },
        stale: false,
      }),
      text: "",
    });
  });

  it("rejects no active editor, disabled settings, and workspace-outside URIs", async () => {
    await expect(
      createAdapter(undefined).readEditorContext({ scope: "active-editor" }, signal()),
    ).rejects.toEqual(new EditorContextUnavailableError());

    const document = createDocument("text", "/workspace/src/index.ts");
    await expect(
      createAdapter(createEditor(document), { enabled: false }).readEditorContext(
        { scope: "active-editor" },
        signal(),
      ),
    ).rejects.toEqual(new EditorContextUnavailableError());

    const outside = createDocument("secret", "/other/secret.txt");
    await expect(
      createAdapter(createEditor(outside)).readEditorContext({ scope: "active-editor" }, signal()),
    ).rejects.toEqual(new EditorContextUnavailableError());
  });

  it("rejects NUL/binary text and malformed UTF-16 selection positions", async () => {
    const binary = createDocument("a\u0000b", "/workspace/src/data.bin");
    await expect(
      createAdapter(createEditor(binary)).readEditorContext({ scope: "active-editor" }, signal()),
    ).rejects.toEqual(new EditorContextUnavailableError());

    const astral = createDocument("😀", "/workspace/src/astral.ts");
    const split = createEditor(astral, position(0, 1), position(0, 1));
    await expect(
      createAdapter(split).readEditorContext({ scope: "selection" }, signal()),
    ).rejects.toEqual(new EditorContextUnavailableError());
  });

  it("bounds code points and logical lines while preserving truncation reasons", async () => {
    const source = `${"a".repeat(maxIdeTextCodePoints)}b`;
    const document = createDocument(source, "/workspace/src/large.ts");
    const result = await createAdapter(createEditor(document)).readEditorContext(
      { scope: "active-editor" },
      signal(),
    );
    expect(result.text).toHaveLength(maxIdeTextCodePoints);
    expect(result.source.truncated).toBe(true);
    expect(result.source.truncationReasons).toEqual(["code-points"]);

    const lines = Array.from({ length: maxIdeTextLines + 1 }, () => "line").join("\r\n");
    const lineResult = await createAdapter(
      createEditor(createDocument(lines, "/workspace/src/lines.ts")),
    ).readEditorContext({ scope: "active-editor" }, signal());
    expect(lineResult.source.truncationReasons).toEqual(["lines"]);
    expect(lineResult.text.endsWith("\r")).toBe(false);
  });

  it("collects large documents through bounded ranges before retaining the prefix", async () => {
    const calls: Array<NonNullable<Parameters<TextDocument["getText"]>[0]> | undefined> = [];
    const source = "a".repeat(maxIdeTextCodePoints + 100);
    const document = createDocument(source, "/workspace/src/chunked.ts", { calls });
    const result = await createAdapter(createEditor(document)).readEditorContext(
      { scope: "active-editor" },
      signal(),
    );

    expect(result.text).toHaveLength(maxIdeTextCodePoints);
    expect(calls).toHaveLength(5);
    expect(calls.every((range) => range !== undefined)).toBe(true);
  });

  it("stops selection range reads after the first hard limit", async () => {
    const calls: Array<NonNullable<Parameters<TextDocument["getText"]>[0]> | undefined> = [];
    const source = "a".repeat(maxIdeTextCodePoints + 100);
    const document = createDocument(source, "/workspace/src/selection.ts", { calls });
    const editor = createEditor(document, position(0, 0), position(0, source.length));
    const result = await createAdapter(editor).readEditorContext({ scope: "selection" }, signal());

    expect(result.text).toHaveLength(maxIdeTextCodePoints);
    expect(result.source.truncationReasons).toEqual(["code-points"]);
    expect(calls).toHaveLength(5);
  });

  it("does not retain a CR when the next CRLF delimiter crosses a hard limit", async () => {
    const calls: Array<NonNullable<Parameters<TextDocument["getText"]>[0]> | undefined> = [];
    const source = `${"a".repeat(maxIdeTextCodePoints - 1)}\r\nrest`;
    const document = createDocument(source, "/workspace/src/crlf.ts", { calls });
    const result = await createAdapter(createEditor(document)).readEditorContext(
      { scope: "active-editor" },
      signal(),
    );

    expect(result.text).toBe("a".repeat(maxIdeTextCodePoints - 1));
    expect(result.text.endsWith("\r")).toBe(false);
    expect(result.source.truncationReasons).toEqual(["code-points"]);
    expect(calls).toHaveLength(5);
  });

  it("maps a failed bounded range read to the fixed unavailable outcome", async () => {
    const document = createDocument("a".repeat(20_000), "/workspace/src/failure.ts", {
      failAtCall: 2,
    });

    await expect(
      createAdapter(createEditor(document)).readEditorContext({ scope: "active-editor" }, signal()),
    ).rejects.toEqual(new EditorContextUnavailableError());
  });

  it("keeps an active-editor capture current when only the selection moves", async () => {
    const document = createDocument("const answer = 42;", "/workspace/src/index.ts");
    const editor = createEditor(document, position(0, 0), position(0, 6));
    let release: (() => void) | undefined;
    const adapter = createAdapter(editor, {
      validate: async (uri, signal) => {
        if (uri.path.endsWith("index.ts")) {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
        signal.throwIfAborted();
        return uri;
      },
    });
    const pending = adapter.readEditorContext({ scope: "active-editor" }, signal());
    await vi.waitFor(() => expect(release).toBeDefined());
    editor.selection = selection(
      position(0, 7),
      position(0, 7),
    ) as unknown as TextEditor["selection"];
    release?.();
    await expect(pending).resolves.toEqual(
      expect.objectContaining({
        source: expect.objectContaining({ stale: false }),
        text: "const answer = 42;",
      }),
    );
  });

  it("marks a changed selection stale but suppresses a switched-editor result", async () => {
    const document = createDocument("text", "/workspace/src/index.ts");
    const editor = createEditor(document, position(0, 0), position(0, 1));
    let active: TextEditor | undefined = editor;
    let release: (() => void) | undefined;
    const adapter = createAdapter(editor, {
      getActiveEditor: () => active,
      validate: async (uri, signal) => {
        if (uri.path.endsWith("index.ts")) {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
        signal.throwIfAborted();
        return uri;
      },
    });
    const pending = adapter.readEditorContext({ scope: "selection" }, signal());
    await vi.waitFor(() => expect(release).toBeDefined());
    editor.selection = selection(
      position(0, 1),
      position(0, 2),
    ) as unknown as TextEditor["selection"];
    release?.();
    await expect(pending).resolves.toEqual(
      expect.objectContaining({
        source: expect.objectContaining({ stale: true }),
        text: "t",
      }),
    );

    const switched = createEditor(createDocument("other", "/workspace/src/other.ts"));
    let switchedRelease: (() => void) | undefined;
    const switchedAdapter = createAdapter(editor, {
      getActiveEditor: () => active,
      validate: async (uri, signal) => {
        if (uri.path.endsWith("index.ts")) {
          await new Promise<void>((resolve) => {
            switchedRelease = resolve;
          });
        }
        signal.throwIfAborted();
        return uri;
      },
    });
    const race = switchedAdapter.readEditorContext({ scope: "active-editor" }, signal());
    await vi.waitFor(() => expect(switchedRelease).toBeDefined());
    active = switched;
    switchedRelease?.();
    await expect(race).rejects.toEqual(new EditorContextUnavailableError());
  });

  it("stops a pending capture on cancellation or disposal", async () => {
    const document = createDocument("text", "/workspace/src/index.ts");
    const editor = createEditor(document);
    let release: (() => void) | undefined;
    const adapter = createAdapter(editor, {
      validate: async (uri, signal) => {
        if (uri.path.endsWith("index.ts")) {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
        signal.throwIfAborted();
        return document.uri;
      },
    });
    const controller = new AbortController();
    const cancellation = new Error("cancel editor capture");
    const pending = adapter.readEditorContext({ scope: "active-editor" }, controller.signal);
    await vi.waitFor(() => expect(release).toBeDefined());
    controller.abort(cancellation);
    release?.();
    await expect(pending).rejects.toBe(cancellation);

    const disposed = createAdapter(editor, {
      validate: async (uri) => {
        if (uri.path.endsWith("index.ts")) {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
        return document.uri;
      },
    });
    const late = disposed.readEditorContext({ scope: "active-editor" }, signal());
    await vi.waitFor(() => expect(release).toBeDefined());
    disposed.dispose();
    release?.();
    await expect(late).rejects.toEqual(new EditorContextUnavailableError());
  });
});

function createAdapter(
  editor: TextEditor | undefined,
  overrides: {
    readonly enabled?: boolean;
    readonly getActiveEditor?: () => TextEditor | undefined;
    readonly validate?: Validate;
  } = {},
): VsCodeEditorContext {
  const root = uri("/workspace");
  const validate =
    overrides.validate ??
    (async (target: Uri, signal: AbortSignal) => {
      const scope = new WorkspaceScope(root, async (value) => value, {
        caseSensitivePaths: true,
      });
      return scope.validate(target, signal);
    });
  return new VsCodeEditorContext({
    getActiveEditor: overrides.getActiveEditor ?? (() => editor),
    getSelectedRoot: () => root,
    createScope: () => ({ validate }),
    isEnabled: () => overrides.enabled ?? true,
    isTrusted: () => true,
  });
}

function createDocument(
  text: string,
  path: string,
  options: {
    readonly calls?: Array<NonNullable<Parameters<TextDocument["getText"]>[0]> | undefined>;
    readonly failAtCall?: number;
  } = {},
): TextDocument {
  const lines = text.split(/\r\n|\n/u);
  const lineOffsets = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\r" && text[index + 1] === "\n") {
      lineOffsets.push(index + 2);
      index += 1;
    } else if (text[index] === "\n" || text[index] === "\r") {
      lineOffsets.push(index + 1);
    }
  }
  let callCount = 0;
  const document = {
    uri: uri(path),
    version: 1,
    languageId: "typescript",
    lineCount: lines.length,
    lineAt(line: number): TextLine {
      const lineText = lines[line];
      if (lineText === undefined) throw new Error("line out of range");
      return { text: lineText } as TextLine;
    },
    getText(range?: NonNullable<Parameters<TextDocument["getText"]>[0]>) {
      callCount += 1;
      options.calls?.push(range);
      if (options.failAtCall === callCount) throw new Error("range read failed");
      if (range === undefined) return text;
      return text.slice(offsetAt(lineOffsets, range.start), offsetAt(lineOffsets, range.end));
    },
  };
  return document as unknown as TextDocument;
}

function offsetAt(
  lineOffsets: readonly number[],
  position: { readonly line: number; readonly character: number },
): number {
  return (lineOffsets[position.line] ?? 0) + position.character;
}

function createEditor(
  document: TextDocument,
  start = position(0, 0),
  end = position(0, 0),
): TextEditor {
  return {
    document,
    selection: selection(start, end),
  } as unknown as TextEditor;
}

function selection(
  start: { line: number; character: number },
  end: { line: number; character: number },
) {
  return { start, end, isEmpty: start.line === end.line && start.character === end.character };
}

function position(line: number, character: number) {
  return { line, character };
}

function signal(): AbortSignal {
  return new AbortController().signal;
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
