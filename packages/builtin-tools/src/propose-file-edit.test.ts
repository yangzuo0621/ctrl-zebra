import { describe, expect, it, vi } from "vitest";

import {
  createProposeFileEditTool,
  InvalidWorkspaceFileRevisionError,
  maxProposedFileEdits,
  maxProposedReplacementCharacters,
  type ProposeFileEditWorkspace,
  StaleFileRevisionError,
} from "./propose-file-edit.js";

const input = {
  path: "src/example.ts",
  edits: [
    {
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 3 },
      },
      newText: "const zebra = true;",
    },
  ],
} as const;

const snapshot = {
  uri: "file:///workspace/src/example.ts",
  revision: { kind: "document_version", value: 7 },
} as const;

describe("propose_file_edit", () => {
  it("publishes its stable nested declaration as a write-risk proposal tool", () => {
    const tool = createProposeFileEditTool(createWorkspace().values);

    expect({
      name: tool.name,
      description: tool.description,
      risk: tool.risk,
      inputSchema: tool.inputSchema,
    }).toEqual({
      name: "propose_file_edit",
      description:
        "Propose bounded text edits for one file in the selected workspace without applying them.",
      risk: "write",
      inputSchema: expect.objectContaining({
        type: "object",
        required: ["path", "edits"],
        additionalProperties: false,
        properties: expect.objectContaining({
          edits: expect.objectContaining({ type: "array", minItems: 1, maxItems: 256 }),
        }),
      }),
    });
  });

  it("returns a canonical, revision-bound proposal without applying a file change", async () => {
    const workspace = createWorkspace();
    const tool = createProposeFileEditTool(workspace.values);
    const parsed = tool.parseInput(input);
    const signal = new AbortController().signal;

    await expect(tool.execute(parsed, { signal })).resolves.toEqual({
      output: {
        uri: snapshot.uri,
        originalRevision: snapshot.revision,
        edits: input.edits,
      },
      truncated: false,
    });
    expect(workspace.captureFileRevision).toHaveBeenCalledWith({ path: input.path }, signal);
    expect(workspace.isFileRevisionCurrent).toHaveBeenCalledWith(snapshot, signal);
  });

  it.each([
    "../outside.ts",
    "/outside.ts",
    "src\\outside.ts",
    "src/./outside.ts",
  ])("rejects an unsafe workspace path %s", (path) => {
    const tool = createProposeFileEditTool(createWorkspace().values);

    expect(() => tool.parseInput({ ...input, path })).toThrow(TypeError);
  });

  it("propagates a canonical workspace-scope rejection without checking a revision", async () => {
    const outsideWorkspace = new Error("outside selected workspace");
    const workspace = createWorkspace({ captureResult: outsideWorkspace });
    const tool = createProposeFileEditTool(workspace.values);

    await expect(
      tool.execute(tool.parseInput(input), { signal: new AbortController().signal }),
    ).rejects.toBe(outsideWorkspace);
    expect(workspace.isFileRevisionCurrent).not.toHaveBeenCalled();
  });

  it("rejects a file revision that expired while creating the proposal", async () => {
    const tool = createProposeFileEditTool(createWorkspace({ current: false }).values);

    await expect(
      tool.execute(tool.parseInput(input), { signal: new AbortController().signal }),
    ).rejects.toBeInstanceOf(StaleFileRevisionError);
  });

  it.each([
    { uri: snapshot.uri, revision: { kind: "document_version", value: -1 } },
    { uri: snapshot.uri },
    { ...snapshot, unexpected: true },
  ])("rejects malformed workspace revision data %#", async (captureResult) => {
    const tool = createProposeFileEditTool(createWorkspace({ captureResult }).values);

    await expect(
      tool.execute(tool.parseInput(input), { signal: new AbortController().signal }),
    ).rejects.toBeInstanceOf(InvalidWorkspaceFileRevisionError);
  });

  it("rejects invalid or oversized edit input", () => {
    const tool = createProposeFileEditTool(createWorkspace().values);
    const edit = input.edits[0];

    expect(() => tool.parseInput({ ...input, edits: [] })).toThrow(TypeError);
    expect(() =>
      tool.parseInput({
        ...input,
        edits: Array.from({ length: maxProposedFileEdits + 1 }, () => edit),
      }),
    ).toThrow(TypeError);
    expect(() =>
      tool.parseInput({
        ...input,
        edits: [{ ...edit, newText: "x".repeat(maxProposedReplacementCharacters + 1) }],
      }),
    ).toThrow(TypeError);
    expect(() =>
      tool.parseInput({
        ...input,
        edits: Array.from({ length: 4 }, (_, line) => ({
          range: {
            start: { line, character: 0 },
            end: { line, character: 0 },
          },
          newText: "x".repeat(200_000),
        })),
      }),
    ).toThrow(TypeError);
  });

  it("forwards cancellation and produces no proposal afterward", async () => {
    const cancellation = new Error("cancel proposal");
    const controller = new AbortController();
    const workspace = createWorkspace({
      captureResult: new Promise((_, reject) => {
        controller.signal.addEventListener("abort", () => reject(controller.signal.reason), {
          once: true,
        });
      }),
    });
    const tool = createProposeFileEditTool(workspace.values);
    const proposal = tool.execute(tool.parseInput(input), { signal: controller.signal });

    controller.abort(cancellation);

    await expect(proposal).rejects.toBe(cancellation);
    expect(workspace.isFileRevisionCurrent).not.toHaveBeenCalled();
  });
});

function createWorkspace(
  options: { readonly captureResult?: unknown; readonly current?: unknown } = {},
) {
  const captureFileRevision = vi.fn(async () => {
    if (options.captureResult instanceof Error) {
      throw options.captureResult;
    }
    return await Promise.resolve(options.captureResult ?? snapshot);
  });
  const isFileRevisionCurrent = vi.fn(async () => options.current ?? true);

  return {
    values: { captureFileRevision, isFileRevisionCurrent } satisfies ProposeFileEditWorkspace,
    captureFileRevision,
    isFileRevisionCurrent,
  };
}
