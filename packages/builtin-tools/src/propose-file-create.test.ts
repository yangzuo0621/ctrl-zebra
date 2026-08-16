import { describe, expect, it, vi } from "vitest";

import {
  createProposeFileCreateTool,
  maxProposedFileCreateBytes,
  maxProposedFileCreateLines,
  type ProposeFileCreateWorkspace,
  StaleFileCreateTargetError,
} from "./propose-file-create.js";

const input = { path: "src/new.txt", content: "zebra\n" } as const;
const snapshot = {
  path: input.path,
  uri: "file:///workspace/src/new.txt",
  afterHash: "a".repeat(64),
} as const;

describe("propose_file_create", () => {
  it("prepares an absent, bounded UTF-8 text target without writing", async () => {
    const workspace = createWorkspace();
    const tool = createProposeFileCreateTool(workspace.values);

    await expect(
      tool.execute(tool.parseInput(input), { signal: new AbortController().signal }),
    ).resolves.toEqual({
      output: {
        operation: "create",
        path: input.path,
        uri: snapshot.uri,
        content: input.content,
        afterHash: snapshot.afterHash,
      },
      truncated: false,
    });
    expect(workspace.captureFileCreateTarget).toHaveBeenCalledWith(input, expect.any(AbortSignal));
    expect(workspace.isFileCreateTargetAbsent).toHaveBeenCalledWith(
      snapshot,
      expect.any(AbortSignal),
    );
  });

  it.each(["../outside.txt", "/outside.txt", "src\\outside.txt", "src/./outside.txt"])(
    "rejects an unsafe path %s",
    (path) => {
      const tool = createProposeFileCreateTool(createWorkspace().values);
      expect(() => tool.parseInput({ ...input, path })).toThrow(TypeError);
    },
  );

  it("rejects oversized and line-heavy content before retaining a proposal", () => {
    const tool = createProposeFileCreateTool(createWorkspace().values);
    expect(() =>
      tool.parseInput({ ...input, content: "x".repeat(maxProposedFileCreateBytes + 1) }),
    ).toThrow(TypeError);
    expect(() =>
      tool.parseInput({
        ...input,
        content: Array.from({ length: maxProposedFileCreateLines + 1 }, () => "x").join("\n"),
      }),
    ).toThrow(TypeError);
  });

  it("rejects a target that appears during preparation", async () => {
    const tool = createProposeFileCreateTool(createWorkspace({ absent: false }).values);
    await expect(
      tool.execute(tool.parseInput(input), { signal: new AbortController().signal }),
    ).rejects.toBeInstanceOf(StaleFileCreateTargetError);
  });
});

function createWorkspace(options: { readonly absent?: boolean } = {}) {
  const captureFileCreateTarget = vi.fn(async () => snapshot);
  const isFileCreateTargetAbsent = vi.fn(async () => options.absent ?? true);
  return {
    values: {
      hashText: () => snapshot.afterHash,
      captureFileCreateTarget,
      isFileCreateTargetAbsent,
    } satisfies ProposeFileCreateWorkspace,
    captureFileCreateTarget,
    isFileCreateTargetAbsent,
  };
}
