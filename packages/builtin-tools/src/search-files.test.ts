import type { ToolExecutionError } from "@ctrl-zebra/core";
import { describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

import {
  createSearchFilesTool,
  defaultSearchFilesLimit,
  listFilesExcludeGlob,
  maxSearchFileBytes,
  maxSearchFileScalars,
  maxSearchFilesLimit,
  maxSearchFilesScanned,
  maxSearchQueryScalars,
  type SearchFilesWorkspace,
  searchFilesInputSchema,
} from "./index.js";

const encoder = new TextEncoder();

describe("search_files", () => {
  it("advertises the exact model-facing schema this tool has always advertised", () => {
    expect(searchFilesInputSchema).toEqual({
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Text or RE2-compatible pattern to search for.",
          minLength: 1,
          maxLength: maxSearchQueryScalars,
        },
        mode: {
          type: "string",
          description: "Search mode. Defaults to literal.",
          enum: ["literal", "regex"],
        },
        glob: {
          type: "string",
          description: "Workspace-relative glob pattern. Defaults to **/*.",
          minLength: 1,
          maxLength: 256,
          pattern: "^(?!.*(?:^|\\/)\\.\\.(?:\\/|$))(?!.*\\\\).+$",
        },
        maxResults: {
          type: "integer",
          description: "Maximum number of matches to return. Defaults to 100.",
          minimum: 1,
          maximum: maxSearchFilesLimit,
        },
      },
      required: ["query"],
      additionalProperties: false,
    });
  });

  it("publishes its stable model declaration", () => {
    const tool = createSearchFilesTool(createWorkspace({}));

    expect({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }).toEqual({
      name: "search_files",
      description:
        "Search bounded UTF-8 workspace text literally or with a controlled RE2-compatible pattern and return matching file locations.",
      inputSchema: expect.objectContaining({
        type: "object",
        required: ["query"],
        additionalProperties: false,
        properties: expect.objectContaining({
          mode: expect.objectContaining({ enum: ["literal", "regex"] }),
        }),
      }),
    });
  });

  it("keeps literal mode as the default and supports bounded RE2 matching", async () => {
    const workspace = createWorkspace({
      "a.txt": "zebra zebra\n猫 zebra",
      "b.txt": "zoo",
    });
    const tool = createSearchFilesTool(workspace);

    await expect(
      tool.execute(tool.parseInput({ query: "z+", mode: "regex" }), {
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({
      output: {
        matches: [
          { path: "a.txt", line: 1, column: 1, preview: "zebra zebra" },
          { path: "a.txt", line: 1, column: 7, preview: "zebra zebra" },
          { path: "a.txt", line: 2, column: 3, preview: "猫 zebra" },
          { path: "b.txt", line: 1, column: 1, preview: "zoo" },
        ],
      },
      truncated: false,
    });
  });

  it("accepts RE2 rune escapes and rejects unsupported escapes and flags", () => {
    const tool = createSearchFilesTool(createWorkspace({}));

    for (const query of ["\\07", "\\123", "\\x7f", "\\x{1f600}", "\\Q(a+)\\E", "\\p{L}"]) {
      expect(() => tool.parseInput({ query, mode: "regex" })).not.toThrow();
    }
    for (const query of ["\\q", "\\Z", "\\C", "\\1", "a{1,2}+", "(?i:zebra)"]) {
      expect(() => tool.parseInput({ query, mode: "regex" })).toThrow(TypeError);
    }
  });

  it("rejects unsupported backreferences, look-around, and possessive syntax", () => {
    const tool = createSearchFilesTool(createWorkspace({}));

    for (const query of ["(a)\\1", "(?=zebra)", "(?<=zebra)", "a*+"]) {
      expect(() => tool.parseInput({ query, mode: "regex" })).toThrow(TypeError);
    }
  });

  it("does not emit empty regex matches", async () => {
    const tool = createSearchFilesTool(createWorkspace({ "a.txt": "bbb" }));

    await expect(
      tool.execute(tool.parseInput({ query: "a*", mode: "regex" }), {
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({ output: { matches: [] }, truncated: false });
  });

  it("handles a catastrophic-backtracking shape with the linear engine", async () => {
    const tool = createSearchFilesTool(createWorkspace({ "a.txt": `${"a".repeat(10_000)}!` }));

    await expect(
      tool.execute(tool.parseInput({ query: "(a+)+$", mode: "regex" }), {
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({ output: { matches: [] }, truncated: false });
  });

  it("matches Unicode classes with one-based UTF-16 columns", async () => {
    const tool = createSearchFilesTool(createWorkspace({ "a.txt": "猫 x" }));

    await expect(
      tool.execute(tool.parseInput({ query: "\\p{L}+", mode: "regex" }), {
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({
      output: {
        matches: [
          { path: "a.txt", line: 1, column: 1, preview: "猫 x" },
          { path: "a.txt", line: 1, column: 3, preview: "猫 x" },
        ],
      },
      truncated: false,
    });
  });

  it("rejects a pattern whose per-file complexity exceeds the budget", async () => {
    const query = "a".repeat(256);
    const tool = createSearchFilesTool(
      createWorkspace({ "a.txt": "a".repeat(maxSearchFileScalars) }),
    );

    await expect(
      tool.execute(tool.parseInput({ query, mode: "regex" }), {
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({
      code: "invalid-input",
      message: "Regex search exceeds the configured complexity limit.",
    } satisfies Partial<ToolExecutionError>);
  });

  it("rejects regex work when the aggregate complexity budget would overflow", async () => {
    const query = "a".repeat(256);
    const files = Object.fromEntries(
      Array.from({ length: 8 }, (_, index) => [`${index}.txt`, "b".repeat(33_000)]),
    );
    const tool = createSearchFilesTool(createWorkspace(files));

    await expect(
      tool.execute(tool.parseInput({ query, mode: "regex" }), {
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: "invalid-input" });
  });

  it("marks regex input truncated when scalar bounds trim a file", async () => {
    const tool = createSearchFilesTool(
      createWorkspace({ "a.txt": `${"x".repeat(maxSearchFileScalars)}z` }),
    );

    await expect(
      tool.execute(tool.parseInput({ query: "z", mode: "regex" }), {
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({ output: { matches: [] }, truncated: true });
  });

  it("returns no matches for text that is absent", async () => {
    const workspace = createWorkspace({ "a.txt": "alpha", "b.txt": "beta" });
    const tool = createSearchFilesTool(workspace);

    await expect(
      tool.execute(tool.parseInput({ query: "zebra" }), {
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({ output: { matches: [] }, truncated: false });
  });

  it("returns deterministic 1-based positions for multiple files and line matches", async () => {
    const workspace = createWorkspace({
      "b.txt": "zebra",
      "a.txt": "one zebra zebra\nthree",
    });
    const tool = createSearchFilesTool(workspace);

    await expect(
      tool.execute(tool.parseInput({ query: "zebra", glob: "**/*.txt" }), {
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({
      output: {
        matches: [
          { path: "a.txt", line: 1, column: 5, preview: "one zebra zebra" },
          { path: "a.txt", line: 1, column: 11, preview: "one zebra zebra" },
          { path: "b.txt", line: 1, column: 1, preview: "zebra" },
        ],
      },
      truncated: false,
    });
    expect(workspace.findFiles).toHaveBeenCalledWith(
      {
        glob: "**/*.txt",
        excludeGlob: listFilesExcludeGlob,
        maxResults: maxSearchFilesScanned + 1,
      },
      expect.any(AbortSignal),
    );
  });

  it("stops at maxResults plus one and marks the output truncated", async () => {
    const workspace = createWorkspace({
      "a.txt": "hit hit hit",
      "b.txt": "hit",
    });
    const tool = createSearchFilesTool(workspace);

    const result = await tool.execute(tool.parseInput({ query: "hit", maxResults: 2 }), {
      signal: new AbortController().signal,
    });

    expect(result.output.matches).toHaveLength(2);
    expect(result.truncated).toBe(true);
    expect(workspace.readFile).toHaveBeenCalledTimes(1);
  });

  it("propagates per-file byte truncation even when no match is found in the prefix", async () => {
    const workspace = createWorkspace({ "large.txt": "prefix" }, { truncated: true });
    const tool = createSearchFilesTool(workspace);

    await expect(
      tool.execute(tool.parseInput({ query: "missing" }), {
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({ output: { matches: [] }, truncated: true });
    expect(workspace.readFile).toHaveBeenCalledWith(
      { path: "large.txt", maxBytes: maxSearchFileBytes + 4 },
      expect.any(AbortSignal),
    );
  });

  it("skips binary and invalid UTF-8 files", async () => {
    const findFiles = vi.fn<SearchFilesWorkspace["findFiles"]>(async () => [
      "binary.dat",
      "invalid.txt",
      "text.txt",
    ]);
    const readFile = vi.fn<SearchFilesWorkspace["readFile"]>(async ({ path }) => {
      if (path === "binary.dat") {
        return { bytes: new Uint8Array([0x68, 0x00, 0x69]), truncated: false };
      }
      if (path === "invalid.txt") {
        return { bytes: new Uint8Array([0xff]), truncated: false };
      }
      return { bytes: encoder.encode("needle"), truncated: false };
    });
    const tool = createSearchFilesTool({ findFiles, readFile });

    const result = await tool.execute(tool.parseInput({ query: "needle" }), {
      signal: new AbortController().signal,
    });

    expect(result).toEqual({
      output: {
        matches: [{ path: "text.txt", line: 1, column: 1, preview: "needle" }],
      },
      truncated: false,
    });
  });

  it("stops before another file after cancellation", async () => {
    const controller = new AbortController();
    const cancellation = new Error("cancel search");
    const findFiles = vi.fn<SearchFilesWorkspace["findFiles"]>(async () => ["a.txt", "b.txt"]);
    const readFile = vi.fn<SearchFilesWorkspace["readFile"]>(async () => {
      controller.abort(cancellation);
      return { bytes: encoder.encode("text"), truncated: false };
    });
    const tool = createSearchFilesTool({ findFiles, readFile });

    await expect(
      tool.execute(tool.parseInput({ query: "text" }), { signal: controller.signal }),
    ).rejects.toBe(cancellation);
    expect(readFile).toHaveBeenCalledTimes(1);
  });

  it("propagates cancellation before regex matching starts", async () => {
    const controller = new AbortController();
    const cancellation = new Error("cancel regex search");
    const findFiles = vi.fn<SearchFilesWorkspace["findFiles"]>(async () => ["a.txt"]);
    const readFile = vi.fn<SearchFilesWorkspace["readFile"]>(async () => {
      controller.abort(cancellation);
      return { bytes: encoder.encode("text"), truncated: false };
    });
    const tool = createSearchFilesTool({ findFiles, readFile });

    await expect(
      tool.execute(tool.parseInput({ query: "text", mode: "regex" }), {
        signal: controller.signal,
      }),
    ).rejects.toBe(cancellation);
  });

  it("enforces scalar, UTF-8, and well-formed query bounds", () => {
    const tool = createSearchFilesTool(createWorkspace({}));

    expect(() => tool.parseInput({ query: "😀".repeat(257) })).toThrow(ZodError);
    expect(() => tool.parseInput({ query: "\ud800" })).toThrow(ZodError);
    expect(() => tool.parseInput({ query: "😀".repeat(256) })).not.toThrow();
  });

  it.each([
    {},
    { query: "" },
    { query: "text", glob: "../**" },
    { query: "text", maxResults: 0 },
    { query: "text", extra: true },
  ])("rejects invalid input %#", (value) => {
    expect(() => createSearchFilesTool(createWorkspace({})).parseInput(value)).toThrow(ZodError);
  });

  it("treats an explicit null glob/maxResults the same as an absent field, but not mode", () => {
    const tool = createSearchFilesTool(createWorkspace({}));

    expect(tool.parseInput({ query: "text", glob: null, maxResults: null })).toEqual({
      query: "text",
      glob: "**/*",
      maxResults: defaultSearchFilesLimit,
      mode: "literal",
    });
    expect(() => tool.parseInput({ query: "text", mode: null })).toThrow(ZodError);
  });
});

function createWorkspace(
  files: Readonly<Record<string, string>>,
  options: { readonly truncated?: boolean } = {},
) {
  return {
    findFiles: vi.fn<SearchFilesWorkspace["findFiles"]>(async () => Object.keys(files)),
    readFile: vi.fn<SearchFilesWorkspace["readFile"]>(async ({ path }) => ({
      bytes: encoder.encode(files[path] ?? ""),
      truncated: options.truncated ?? false,
    })),
  } satisfies SearchFilesWorkspace;
}
