import { describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

import {
  createProposeFileCreateTool,
  maxProposedFileCreateBytes,
  maxProposedFileCreateCharacters,
  maxProposedFileCreateLines,
  type ProposeFileCreateWorkspace,
  proposeFileCreateInputSchema,
  StaleFileCreateTargetError,
} from "./propose-file-create.js";

const input = { path: "src/new.txt", content: "zebra\n" } as const;
const snapshot = {
  path: input.path,
  uri: "file:///workspace/src/new.txt",
  afterHash: "a".repeat(64),
} as const;

describe("propose_file_create", () => {
  it("advertises the exact model-facing schema this tool has always advertised", () => {
    expect(proposeFileCreateInputSchema).toEqual({
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Workspace-relative file path using forward slashes.",
          minLength: 1,
          maxLength: 4_096,
          pattern: "^(?!\\/)(?!.*\\\\)(?!.*(?:^|\\/)\\.{1,2}(?:\\/|$)).+$",
        },
        content: {
          type: "string",
          description: "Complete UTF-8 text content for the new file.",
          maxLength: maxProposedFileCreateCharacters,
        },
      },
      required: ["path", "content"],
      additionalProperties: false,
    });
  });

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
      expect(() => tool.parseInput({ ...input, path })).toThrow(ZodError);
    },
  );

  it("rejects oversized and line-heavy content before retaining a proposal", () => {
    const tool = createProposeFileCreateTool(createWorkspace().values);
    expect(() =>
      tool.parseInput({ ...input, content: "x".repeat(maxProposedFileCreateBytes + 1) }),
    ).toThrow(ZodError);
    expect(() =>
      tool.parseInput({
        ...input,
        content: Array.from({ length: maxProposedFileCreateLines + 1 }, () => "x").join("\n"),
      }),
    ).toThrow(ZodError);
  });

  it("counts content by Unicode code point, not UTF-16 code unit, at the character bound", () => {
    const tool = createProposeFileCreateTool(createWorkspace().values);
    const atLimit = "\u{1F600}".repeat(maxProposedFileCreateCharacters);

    expect(tool.parseInput({ ...input, content: atLimit }).content).toBe(atLimit);
    expect(() => tool.parseInput({ ...input, content: `${atLimit}\u{1F600}` })).toThrow(ZodError);
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
