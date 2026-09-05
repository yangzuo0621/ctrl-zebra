import { describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

import {
  createProposeFileRenameTool,
  type ProposeFileRenameWorkspace,
  proposeFileRenameInputSchema,
  StaleFileRenameTargetError,
} from "./propose-file-rename.js";

const input = { sourcePath: "src/old.txt", targetPath: "src/new.txt" } as const;
const snapshot = {
  ...input,
  sourceUri: "file:///workspace/src/old.txt",
  targetUri: "file:///workspace/src/new.txt",
  beforeContent: "zebra\n",
  beforeHash: "a".repeat(64),
} as const;

describe("propose_file_rename", () => {
  it("advertises the exact model-facing schema this tool has always advertised", () => {
    expect(proposeFileRenameInputSchema).toEqual({
      type: "object",
      properties: {
        sourcePath: {
          type: "string",
          description: "Workspace-relative existing file path using forward slashes.",
          minLength: 1,
          maxLength: 4_096,
          pattern: "^(?!\\/)(?!.*\\\\)(?!.*(?:^|\\/)\\.{1,2}(?:\\/|$)).+$",
        },
        targetPath: {
          type: "string",
          description: "Workspace-relative absent destination path using forward slashes.",
          minLength: 1,
          maxLength: 4_096,
          pattern: "^(?!\\/)(?!.*\\\\)(?!.*(?:^|\\/)\\.{1,2}(?:\\/|$)).+$",
        },
      },
      required: ["sourcePath", "targetPath"],
      additionalProperties: false,
    });
  });

  it("prepares a source/target pair without writing or overwriting", async () => {
    const workspace = createWorkspace();
    const tool = createProposeFileRenameTool(workspace.values);

    await expect(
      tool.execute(tool.parseInput(input), { signal: new AbortController().signal }),
    ).resolves.toEqual({
      output: { operation: "rename", ...snapshot },
      truncated: false,
    });
    expect(workspace.captureFileRenameTarget).toHaveBeenCalledWith(input, expect.any(AbortSignal));
    expect(workspace.isFileRenameTargetCurrent).toHaveBeenCalledWith(
      snapshot,
      expect.any(AbortSignal),
    );
  });

  it.each([
    { sourcePath: "../old.txt", targetPath: "new.txt" },
    { sourcePath: "old.txt", targetPath: "/new.txt" },
    { sourcePath: "old.txt", targetPath: "old.txt" },
    { sourcePath: "old\\txt", targetPath: "new.txt" },
  ])("rejects an unsafe or colliding path pair %#", (value) => {
    const tool = createProposeFileRenameTool(createWorkspace().values);
    expect(() => tool.parseInput(value)).toThrow(ZodError);
  });

  it("rejects a source or target that changed during preparation", async () => {
    const tool = createProposeFileRenameTool(createWorkspace({ current: false }).values);
    await expect(
      tool.execute(tool.parseInput(input), { signal: new AbortController().signal }),
    ).rejects.toBeInstanceOf(StaleFileRenameTargetError);
  });
});

function createWorkspace(options: { readonly current?: boolean } = {}) {
  const captureFileRenameTarget = vi.fn(async () => snapshot);
  const isFileRenameTargetCurrent = vi.fn(async () => options.current ?? true);
  return {
    values: {
      hashText: () => snapshot.beforeHash,
      captureFileRenameTarget,
      isFileRenameTargetCurrent,
    } satisfies ProposeFileRenameWorkspace,
    captureFileRenameTarget,
    isFileRenameTargetCurrent,
  };
}
