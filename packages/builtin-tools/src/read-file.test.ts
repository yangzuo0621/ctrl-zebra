import { describe, expect, it, vi } from "vitest";

import {
  BinaryFileError,
  createReadFileTool,
  InvalidWorkspaceFileReadError,
  maxReadFileContentBytes,
  type ReadFileBytes,
  ReadFileRangeError,
  type ReadFileWorkspace,
  readFileUtf8LookaheadBytes,
} from "./index.js";

const encoder = new TextEncoder();

describe("read_file", () => {
  it("decodes UTF-8 and returns the requested inclusive line range", async () => {
    const workspace = createWorkspace(bytes("一\ntwo\n三"));
    const tool = createReadFileTool(workspace);
    const input = tool.parseInput({ path: "src/example.txt", startLine: 2, endLine: 3 });

    await expect(tool.execute(input, { signal: new AbortController().signal })).resolves.toEqual({
      output: {
        path: "src/example.txt",
        startLine: 2,
        endLine: 3,
        content: "two\n三",
      },
      truncated: false,
    });
    expect(workspace.readFile).toHaveBeenCalledWith(
      {
        path: "src/example.txt",
        maxBytes: maxReadFileContentBytes + readFileUtf8LookaheadBytes,
      },
      expect.any(AbortSignal),
    );
  });

  it("returns an empty text file without inventing a line", async () => {
    const tool = createReadFileTool(createWorkspace(bytes("")));

    await expect(
      tool.execute(tool.parseInput({ path: "empty.txt" }), {
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({
      output: { path: "empty.txt", startLine: 1, endLine: 0, content: "" },
      truncated: false,
    });
  });

  it("clamps an end line beyond the complete file", async () => {
    const tool = createReadFileTool(createWorkspace(bytes("one\ntwo")));

    await expect(
      tool.execute(tool.parseInput({ path: "file.txt", startLine: 2, endLine: 20 }), {
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({
      output: { path: "file.txt", startLine: 2, endLine: 2, content: "two" },
      truncated: false,
    });
  });

  it("limits a large file and marks the Tool Result truncated", async () => {
    const source = new Uint8Array(maxReadFileContentBytes + readFileUtf8LookaheadBytes);
    source.fill("a".charCodeAt(0));
    const tool = createReadFileTool(createWorkspace({ bytes: source, truncated: true }));

    const result = await tool.execute(tool.parseInput({ path: "large.txt" }), {
      signal: new AbortController().signal,
    });

    expect(result.output.content).toHaveLength(maxReadFileContentBytes);
    expect(result.truncated).toBe(true);
  });

  it("removes only an incomplete UTF-8 suffix from a truncated prefix", async () => {
    const prefix = encoder.encode(`${"a".repeat(maxReadFileContentBytes - 1)}界`);
    const tool = createReadFileTool(createWorkspace({ bytes: prefix, truncated: true }));

    const result = await tool.execute(tool.parseInput({ path: "large-utf8.txt" }), {
      signal: new AbortController().signal,
    });

    expect(result.output.content).toBe("a".repeat(maxReadFileContentBytes - 1));
    expect(result.truncated).toBe(true);
  });

  it.each([
    { bytes: new Uint8Array([0x61, 0x00, 0x62]), truncated: false },
    { bytes: new Uint8Array([0xff]), truncated: false },
  ])("rejects binary input %#", async (source) => {
    const tool = createReadFileTool(createWorkspace(source));

    await expect(
      tool.execute(tool.parseInput({ path: "binary.dat" }), {
        signal: new AbortController().signal,
      }),
    ).rejects.toEqual(new BinaryFileError());
  });

  it.each([
    { path: "" },
    { path: "../outside.txt" },
    { path: "src\\file.txt" },
    { path: "file.txt", startLine: 0 },
    { path: "file.txt", startLine: 3, endLine: 2 },
    { path: "file.txt", extra: true },
  ])("rejects invalid input %#", (value) => {
    expect(() => createReadFileTool(createWorkspace(bytes(""))).parseInput(value)).toThrow(
      TypeError,
    );
  });

  it("rejects a start line outside the available text", async () => {
    const tool = createReadFileTool(createWorkspace(bytes("one\ntwo")));

    await expect(
      tool.execute(tool.parseInput({ path: "file.txt", startLine: 3 }), {
        signal: new AbortController().signal,
      }),
    ).rejects.toEqual(new ReadFileRangeError());
  });

  it.each([
    null,
    { bytes: "text", truncated: false },
    { bytes: new Uint8Array(), truncated: 1 },
  ])("rejects invalid host output %#", async (source) => {
    const tool = createReadFileTool(createWorkspace(source));

    await expect(
      tool.execute(tool.parseInput({ path: "file.txt" }), {
        signal: new AbortController().signal,
      }),
    ).rejects.toEqual(new InvalidWorkspaceFileReadError());
  });

  it("does not call the workspace after cancellation", async () => {
    const controller = new AbortController();
    const cancellation = new Error("cancel read");
    controller.abort(cancellation);
    const workspace = createWorkspace(bytes("text"));
    const tool = createReadFileTool(workspace);

    await expect(
      tool.execute(tool.parseInput({ path: "file.txt" }), { signal: controller.signal }),
    ).rejects.toBe(cancellation);
    expect(workspace.readFile).not.toHaveBeenCalled();
  });
});

function bytes(text: string): ReadFileBytes {
  return { bytes: encoder.encode(text), truncated: false };
}

function createWorkspace(value: unknown) {
  return {
    readFile: vi.fn<ReadFileWorkspace["readFile"]>(async () => value),
  } satisfies ReadFileWorkspace;
}
