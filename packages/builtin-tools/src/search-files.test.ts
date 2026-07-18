import { describe, expect, it, vi } from "vitest";

import {
  createSearchFilesTool,
  listFilesExcludeGlob,
  maxSearchFileBytes,
  maxSearchFilesScanned,
  type SearchFilesWorkspace,
} from "./index.js";

const encoder = new TextEncoder();

describe("search_files", () => {
  it("publishes its stable model declaration", () => {
    const tool = createSearchFilesTool(createWorkspace({}));

    expect({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }).toEqual({
      name: "search_files",
      description: "Search bounded UTF-8 workspace text and return matching file locations.",
      inputSchema: expect.objectContaining({
        type: "object",
        required: ["query"],
        additionalProperties: false,
      }),
    });
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

  it.each([
    {},
    { query: "" },
    { query: "text", glob: "../**" },
    { query: "text", maxResults: 0 },
    { query: "text", extra: true },
  ])("rejects invalid input %#", (value) => {
    expect(() => createSearchFilesTool(createWorkspace({})).parseInput(value)).toThrow(TypeError);
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
