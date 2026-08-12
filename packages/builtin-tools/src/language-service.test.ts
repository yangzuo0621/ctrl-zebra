import { ToolExecutionError } from "@ctrl-zebra/core";
import { describe, expect, it, vi } from "vitest";

import {
  createFindDefinitionTool,
  createFindReferencesTool,
  createListSymbolsTool,
  type IdeLanguageServicePort,
  InvalidLanguageServiceOutputError,
  LanguageServiceUnavailableError,
  parseLanguageServiceInput,
  parseListSymbolsInput,
} from "./index.js";

const resultSource = {
  uri: { scheme: "file", authority: "", path: "src/index.ts" },
  stale: false,
  truncated: false,
} as const;
const range = {
  start: { line: 0, character: 0 },
  end: { line: 0, character: 3 },
} as const;

describe("language service built-in tools", () => {
  it("parses bounded path and UTF-16 position inputs strictly", () => {
    expect(
      parseLanguageServiceInput({ path: "src/index.ts", position: { line: 1, character: 2 } }),
    ).toEqual({
      path: "src/index.ts",
      position: { line: 1, character: 2 },
    });
    expect(parseListSymbolsInput({ path: "src/index.ts" })).toEqual({ path: "src/index.ts" });
    expect(() =>
      parseLanguageServiceInput({ path: "../secret", position: { line: 0, character: 0 } }),
    ).toThrow();
    expect(() =>
      parseLanguageServiceInput({
        path: "src/%2e%2e/secret",
        position: { line: 0, character: 0 },
      }),
    ).toThrow();
    expect(() =>
      parseLanguageServiceInput({
        path: "src//index.ts",
        position: { line: 0, character: 0 },
      }),
    ).toThrow();
    expect(() =>
      parseLanguageServiceInput({
        path: `src/${String.fromCharCode(0xd800)}.ts`,
        position: { line: 0, character: 0 },
      }),
    ).toThrow();
    expect(() =>
      parseLanguageServiceInput({
        path: "src/index.ts",
        position: { line: 0, character: 0, extra: true },
      }),
    ).toThrow();
    expect(() => parseListSymbolsInput({ path: "src/index.ts", extra: true })).toThrow();
    expect(() =>
      parseLanguageServiceInput({
        path: "src/index.ts",
        position: { line: Number.NaN, character: 0 },
      }),
    ).toThrow();
    expect(() =>
      parseLanguageServiceInput({
        path: "src/index.ts",
        position: { line: 0, character: Number.POSITIVE_INFINITY },
      }),
    ).toThrow();
  });

  it("projects definitions, references, and symbols as read-only outputs", async () => {
    const port = createPort({
      findDefinition: async () => ({
        kind: "language-locations",
        operation: "definition",
        source: resultSource,
        locations: [{ source: resultSource, range, kind: "definition" }],
        stale: false,
        truncated: false,
      }),
      findReferences: async () => ({
        kind: "language-locations",
        operation: "references",
        source: resultSource,
        locations: [{ source: resultSource, range, kind: "reference" }],
        stale: false,
        truncated: false,
      }),
      listSymbols: async () => ({
        kind: "symbols",
        source: resultSource,
        symbols: [{ name: "answer", kind: "variable", range }],
        stale: false,
        truncated: false,
      }),
    });
    const signal = new AbortController().signal;
    await expect(
      createFindDefinitionTool(port).execute(
        { path: "src/index.ts", position: { line: 0, character: 0 } },
        { signal },
      ),
    ).resolves.toMatchObject({ output: { operation: "definition" }, truncated: false });
    await expect(
      createFindReferencesTool(port).execute(
        { path: "src/index.ts", position: { line: 0, character: 0 } },
        { signal },
      ),
    ).resolves.toMatchObject({ output: { operation: "references" } });
    await expect(
      createListSymbolsTool(port).execute({ path: "src/index.ts" }, { signal }),
    ).resolves.toMatchObject({ output: { symbols: [{ name: "answer" }] } });
    expect(port.findDefinition).toHaveBeenCalledWith(
      { path: "src/index.ts", position: { line: 0, character: 0 } },
      signal,
    );
  });

  it("maps unavailable, invalid, mismatched, and cancelled outcomes", async () => {
    const unavailable = createPort({
      findDefinition: async () => {
        throw new LanguageServiceUnavailableError();
      },
    });
    await expect(
      createFindDefinitionTool(unavailable).execute(
        { path: "src/index.ts", position: { line: 0, character: 0 } },
        { signal: new AbortController().signal },
      ),
    ).rejects.toMatchObject({ code: "failed" });

    const invalid = createPort({
      findDefinition: async () => {
        throw new InvalidLanguageServiceOutputError();
      },
    });
    await expect(
      createFindDefinitionTool(invalid).execute(
        { path: "src/index.ts", position: { line: 0, character: 0 } },
        { signal: new AbortController().signal },
      ),
    ).rejects.toMatchObject({ code: "invalid-output" });

    const mismatch = createPort({
      findDefinition: async () => ({
        kind: "language-locations",
        operation: "references",
        source: resultSource,
        locations: [],
        stale: false,
        truncated: false,
      }),
    });
    await expect(
      createFindDefinitionTool(mismatch).execute(
        { path: "src/index.ts", position: { line: 0, character: 0 } },
        { signal: new AbortController().signal },
      ),
    ).rejects.toMatchObject({ code: "invalid-output" });

    const controller = new AbortController();
    const release = deferred<unknown>();
    const cancelled = createFindDefinitionTool(
      createPort({ findDefinition: async () => release.promise }),
    ).execute(
      { path: "src/index.ts", position: { line: 0, character: 0 } },
      { signal: controller.signal },
    );
    controller.abort(new Error("cancelled"));
    release.resolve([]);
    await expect(cancelled).rejects.toThrow("cancelled");
  });

  it("rejects a provider result with a mismatched operation after schema validation", async () => {
    const tool = createFindReferencesTool(
      createPort({
        findReferences: async () => ({
          kind: "language-locations",
          operation: "definition",
          source: resultSource,
          locations: [],
          stale: false,
          truncated: false,
        }),
      }),
    );

    await expect(
      tool.execute(
        { path: "src/index.ts", position: { line: 0, character: 0 } },
        { signal: new AbortController().signal },
      ),
    ).rejects.toEqual(
      new ToolExecutionError("invalid-output", "Language service returned invalid output."),
    );
  });
});

function createPort(
  overrides: Partial<{
    [K in keyof IdeLanguageServicePort]: IdeLanguageServicePort[K];
  }> = {},
): IdeLanguageServicePort & Record<string, ReturnType<typeof vi.fn>> {
  return {
    findDefinition: vi.fn(overrides.findDefinition ?? (async () => [])),
    findReferences: vi.fn(overrides.findReferences ?? (async () => [])),
    listSymbols: vi.fn(overrides.listSymbols ?? (async () => [])),
  } as unknown as IdeLanguageServicePort & Record<string, ReturnType<typeof vi.fn>>;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
