import { describe, expect, it, vi } from "vitest";
import { ZodError, z } from "zod";

import {
  createProposeWorkspaceEditTool,
  maxProposedWorkspaceEditEdits,
  maxProposedWorkspaceEditFiles,
  maxProposedWorkspaceEditReplacementCharacters,
  maxTotalProposedWorkspaceEditReplacementBytes,
  minProposedWorkspaceEditFiles,
  type ProposeWorkspaceEditWorkspace,
  proposeWorkspaceEditInputSchema,
  StaleWorkspaceEditTargetError,
} from "./propose-workspace-edit.js";
import { textPositionSchema } from "./text-edit-schema.js";

// Derived from the real schema, rather than a hand-duplicated literal (also used by
// propose-file-edit.test.ts), so the two can never independently drift from it or from each
// other. `$schema` only belongs at a true document root, not this nested position.
const { $schema: _schema, ...positionSchema } = z.toJSONSchema(textPositionSchema);

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
  it("advertises the exact model-facing schema this tool has always advertised", () => {
    expect(proposeWorkspaceEditInputSchema).toEqual({
      type: "object",
      properties: {
        files: {
          type: "array",
          description: "At least two existing files with non-overlapping edits.",
          minItems: minProposedWorkspaceEditFiles,
          maxItems: maxProposedWorkspaceEditFiles,
          items: {
            type: "object",
            description: "One existing workspace file and its non-overlapping edits.",
            properties: {
              path: {
                type: "string",
                description: "Workspace-relative file path using forward slashes.",
                minLength: 1,
                maxLength: 4_096,
                pattern: "^(?!\\/)(?!.*\\\\)(?!.*(?:^|\\/)\\.{1,2}(?:\\/|$)).+$",
              },
              edits: {
                type: "array",
                description: "Non-overlapping text edits for this file.",
                minItems: 1,
                maxItems: maxProposedWorkspaceEditEdits,
                items: {
                  type: "object",
                  description: "One replacement over a half-open text range.",
                  properties: {
                    range: {
                      type: "object",
                      description: "A zero-based half-open text range.",
                      properties: { start: positionSchema, end: positionSchema },
                      required: ["start", "end"],
                      additionalProperties: false,
                    },
                    newText: {
                      type: "string",
                      description: "Replacement text.",
                      maxLength: maxProposedWorkspaceEditReplacementCharacters,
                    },
                  },
                  required: ["range", "newText"],
                  additionalProperties: false,
                },
              },
            },
            required: ["path", "edits"],
            additionalProperties: false,
          },
        },
      },
      required: ["files"],
      additionalProperties: false,
    });
  });

  it("declares a write-risk multi-file preparation tool", () => {
    const tool = createProposeWorkspaceEditTool(createWorkspace().values);
    expect({ name: tool.name, risk: tool.risk, inputSchema: tool.inputSchema }).toEqual({
      name: "propose_workspace_edit",
      risk: "write",
      inputSchema: expect.objectContaining({
        type: "object",
        required: ["files"],
        additionalProperties: false,
        properties: {
          files: expect.objectContaining({ minItems: minProposedWorkspaceEditFiles }),
        },
      }),
    });
    const objectSchema = tool.inputSchema as unknown as {
      readonly properties: {
        readonly files: {
          readonly items: {
            readonly properties: { readonly edits: { readonly maxItems: number } };
          };
        };
      };
    };
    expect(objectSchema.properties.files.items.properties.edits.maxItems).toBe(
      maxProposedWorkspaceEditEdits,
    );
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
    expect(() => tool.parseInput(candidate)).toThrow(ZodError);
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
    // Not rejected by the schema (newText carries no zod-level length bound -- see the schema's
    // own docs for why), so this reaches the parser's isBoundedWorkspaceEditText check and still
    // throws the tool's own TypeError, exactly as the hand-written parser did.
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

  it("rejects more than the shared per-file edit limit before host capture", () => {
    const tool = createProposeWorkspaceEditTool(createWorkspace().values);
    const oversized = {
      files: [
        {
          ...input.files[0],
          edits: Array.from({ length: maxProposedWorkspaceEditEdits + 1 }, (_, index) => ({
            range: {
              start: { line: 0, character: index },
              end: { line: 0, character: index },
            },
            newText: "",
          })),
        },
        input.files[1],
      ],
    };
    expect(() => tool.parseInput(oversized)).toThrow(ZodError);
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
