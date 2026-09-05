import { describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

import {
  createProposeFileDeleteTool,
  type ProposeFileDeleteWorkspace,
  proposeFileDeleteInputSchema,
  StaleFileDeleteTargetError,
} from "./propose-file-delete.js";

const input = { path: "src/old.txt" } as const;
const snapshot = {
  path: input.path,
  uri: "file:///workspace/src/old.txt",
  beforeContent: "zebra\n",
  beforeHash: "a".repeat(64),
} as const;

describe("propose_file_delete", () => {
  it("advertises the exact model-facing schema this tool has always advertised", () => {
    expect(proposeFileDeleteInputSchema).toEqual({
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Workspace-relative file path using forward slashes.",
          minLength: 1,
          maxLength: 4_096,
          pattern: "^(?!\\/)(?!.*\\\\)(?!.*(?:^|\\/)\\.{1,2}(?:\\/|$)).+$",
        },
      },
      required: ["path"],
      additionalProperties: false,
    });
  });

  it("prepares a bounded existing text target without writing", async () => {
    const workspace = createWorkspace();
    const tool = createProposeFileDeleteTool(workspace.values);

    await expect(
      tool.execute(tool.parseInput(input), { signal: new AbortController().signal }),
    ).resolves.toEqual({
      output: { operation: "delete", ...snapshot },
      truncated: false,
    });
    expect(workspace.captureFileDeleteTarget).toHaveBeenCalledWith(input, expect.any(AbortSignal));
    expect(workspace.isFileDeleteTargetCurrent).toHaveBeenCalledWith(
      snapshot,
      expect.any(AbortSignal),
    );
  });

  it.each(["../outside.txt", "/outside.txt", "src\\old.txt", "src/./old.txt"])(
    "rejects an unsafe path %s",
    (path) => {
      const tool = createProposeFileDeleteTool(createWorkspace().values);
      expect(() => tool.parseInput({ path })).toThrow(ZodError);
    },
  );

  it("rejects a target that changed during preparation", async () => {
    const tool = createProposeFileDeleteTool(createWorkspace({ current: false }).values);
    await expect(
      tool.execute(tool.parseInput(input), { signal: new AbortController().signal }),
    ).rejects.toBeInstanceOf(StaleFileDeleteTargetError);
  });

  it("does not invoke the workspace after cancellation", async () => {
    const workspace = createWorkspace();
    const controller = new AbortController();
    const cancellation = new Error("cancel delete");
    controller.abort(cancellation);
    const tool = createProposeFileDeleteTool(workspace.values);

    await expect(tool.execute(tool.parseInput(input), { signal: controller.signal })).rejects.toBe(
      cancellation,
    );
    expect(workspace.captureFileDeleteTarget).not.toHaveBeenCalled();
  });
});

function createWorkspace(options: { readonly current?: boolean } = {}) {
  const captureFileDeleteTarget = vi.fn(async () => snapshot);
  const isFileDeleteTargetCurrent = vi.fn(async () => options.current ?? true);
  return {
    values: {
      hashText: () => snapshot.beforeHash,
      captureFileDeleteTarget,
      isFileDeleteTargetCurrent,
    } satisfies ProposeFileDeleteWorkspace,
    captureFileDeleteTarget,
    isFileDeleteTargetCurrent,
  };
}
