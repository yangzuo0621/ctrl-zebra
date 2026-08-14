import { describe, expect, it, vi } from "vitest";

import {
  createProposeWorkspaceEditTool,
  maxProposedWorkspaceEditFiles,
  maxTotalProposedWorkspaceEditReplacementBytes,
  minProposedWorkspaceEditFiles,
  type ProposeWorkspaceEditWorkspace,
  StaleWorkspaceEditTargetError,
} from "./propose-workspace-edit.js";

const input = {
  files: [
    {
      path: "src/b.ts",
      edits: [
        {
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
          newText: "two",
        },
      ],
    },
    {
      path: "src/a.ts",
      edits: [
        {
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
          newText: "one",
        },
      ],
    },
  ],
} as const;

const snapshots = new Map([
  [
    "src/a.ts",
    { uri: "file:///workspace/src/a.ts", revision: { kind: "document_version", value: 1 } },
  ],
  [
    "src/b.ts",
    { uri: "file:///workspace/src/b.ts", revision: { kind: "document_version", value: 2 } },
  ],
]);

describe("propose_workspace_edit", () => {
  it("declares a write-risk multi-file preparation tool", () => {
    const tool = createProposeWorkspaceEditTool(createWorkspace().values);
    expect({ name: tool.name, risk: tool.risk, inputSchema: tool.inputSchema }).toEqual({
      name: "propose_workspace_edit",
      risk: "write",
      inputSchema: expect.objectContaining({
        type: "object",
        required: ["files"],
        additionalProperties: false,
        properties: { files: expect.objectContaining({ minItems: minProposedWorkspaceEditFiles }) },
      }),
    });
  });

  it("captures and rechecks every target before returning a sorted immutable plan", async () => {
    const workspace = createWorkspace();
    const tool = createProposeWorkspaceEditTool(workspace.values);

    await expect(
      tool.execute(tool.parseInput(input), { signal: new AbortController().signal }),
    ).resolves.toEqual({
      output: {
        operation: "edit",
        files: [
          {
            path: "src/a.ts",
            uri: snapshots.get("src/a.ts")?.uri,
            originalRevision: snapshots.get("src/a.ts")?.revision,
            edits: input.files[1]?.edits,
          },
          {
            path: "src/b.ts",
            uri: snapshots.get("src/b.ts")?.uri,
            originalRevision: snapshots.get("src/b.ts")?.revision,
            edits: input.files[0]?.edits,
          },
        ],
      },
      truncated: false,
    });
    expect(workspace.captureFileRevision).toHaveBeenCalledTimes(2);
    expect(workspace.isFileRevisionCurrent).toHaveBeenCalledTimes(2);
  });

  it.each([
    { files: [input.files[0]] },
    {
      files: Array.from({ length: maxProposedWorkspaceEditFiles + 1 }, (_, index) => ({
        ...input.files[0],
        path: `file-${index}.ts`,
      })),
    },
    { files: [{ ...input.files[0], path: "../outside.ts" }, input.files[1]] },
    { files: [input.files[0], input.files[0]] },
  ])("rejects invalid input %#", (candidate) => {
    const tool = createProposeWorkspaceEditTool(createWorkspace().values);
    expect(() => tool.parseInput(candidate)).toThrow(TypeError);
  });

  it("rejects a stale target without checking later targets", async () => {
    const workspace = createWorkspace({ current: false });
    const tool = createProposeWorkspaceEditTool(workspace.values);
    await expect(
      tool.execute(tool.parseInput(input), { signal: new AbortController().signal }),
    ).rejects.toBeInstanceOf(StaleWorkspaceEditTargetError);
    expect(workspace.captureFileRevision).toHaveBeenCalledTimes(1);
    expect(workspace.isFileRevisionCurrent).toHaveBeenCalledTimes(1);
  });

  it("rejects aggregate replacement overflow before host capture", () => {
    const tool = createProposeWorkspaceEditTool(createWorkspace().values);
    const oversized = {
      files: [
        {
          ...input.files[0],
          edits: [
            {
              ...input.files[0]?.edits[0],
              newText: "x".repeat(maxTotalProposedWorkspaceEditReplacementBytes),
            },
          ],
        },
        input.files[1],
      ],
    };
    expect(() => tool.parseInput(oversized)).toThrow(TypeError);
  });

  it("forwards cancellation and does not capture another target", async () => {
    const controller = new AbortController();
    const cancellation = new Error("cancel proposal");
    const captureFileRevision = vi.fn(async ({ path }: { path: string }) => {
      if (path === "src/b.ts") {
        controller.abort(cancellation);
      }
      return snapshots.get(path);
    });
    const workspace: ProposeWorkspaceEditWorkspace = {
      captureFileRevision,
      isFileRevisionCurrent: vi.fn(async () => true),
    };
    const tool = createProposeWorkspaceEditTool(workspace);
    await expect(tool.execute(tool.parseInput(input), { signal: controller.signal })).rejects.toBe(
      cancellation,
    );
    expect(captureFileRevision).toHaveBeenCalledTimes(1);
  });
});

function createWorkspace(options: { readonly current?: boolean } = {}) {
  const captureFileRevision = vi.fn(async ({ path }: { path: string }) => snapshots.get(path));
  const isFileRevisionCurrent = vi.fn(async () => options.current ?? true);
  return {
    values: { captureFileRevision, isFileRevisionCurrent } satisfies ProposeWorkspaceEditWorkspace,
    captureFileRevision,
    isFileRevisionCurrent,
  };
}
