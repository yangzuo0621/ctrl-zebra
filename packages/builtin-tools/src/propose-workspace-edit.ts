import {
  type AgentTool,
  InvalidWorkspaceEditPlanError,
  isBoundedWorkspaceEditText,
  maxTextEdits,
  maxWorkspaceEditAggregateReplacementBytes,
  maxWorkspaceEditFiles,
  maxWorkspaceEditPathBytes,
  maxWorkspaceEditReplacementBytes,
  maxWorkspaceEditReplacementCharacters,
  minWorkspaceEditFiles,
  parseTextEdits,
  parseWorkspaceEditPlan,
  type TextEdit,
  type ToolExecutionOutput,
  type WorkspaceEditPlan,
} from "@ctrl-zebra/core";
import { utf8ByteLength } from "@ctrl-zebra/protocol";
import { z } from "zod";
import {
  InvalidWorkspaceFileRevisionError,
  type ProposeFileEditWorkspace,
  parseFileEditRevisionSnapshot,
} from "./propose-file-edit.js";
import { textRangeSchema } from "./text-edit-schema.js";
import { workspaceRelativePathSchema } from "./workspace-path-schema.js";
import { toToolInputSchema } from "./zod-tool-schema.js";

export const proposeWorkspaceEditToolName = "propose_workspace_edit" as const;
export const proposeWorkspaceEditToolDescription =
  "Propose bounded text edits across multiple selected-workspace files; changes apply atomically only after explicit user approval.";

export const maxProposedWorkspaceEditFiles = maxWorkspaceEditFiles;
export const maxProposedWorkspaceEditEdits = maxTextEdits;
export const minProposedWorkspaceEditFiles = minWorkspaceEditFiles;
export const maxProposedWorkspaceEditReplacementCharacters = maxWorkspaceEditReplacementCharacters;
export const maxProposedWorkspaceEditReplacementBytes = maxWorkspaceEditReplacementBytes;
export const maxTotalProposedWorkspaceEditReplacementBytes =
  maxWorkspaceEditAggregateReplacementBytes;
export const maxProposedWorkspaceEditPathBytes = maxWorkspaceEditPathBytes;

const proposeWorkspaceEditZodSchema = z
  .strictObject({
    files: z
      .array(
        z
          .strictObject({
            path: workspaceRelativePathSchema(
              "Workspace-relative file path using forward slashes.",
              4_096,
              maxProposedWorkspaceEditPathBytes,
            ),
            edits: z
              .array(
                z
                  .strictObject({
                    range: textRangeSchema,
                    // isBoundedWorkspaceEditText (core) counts this bound by Unicode code point,
                    // not UTF-16 code unit -- not what zod's `.max()` would count -- so the bound
                    // itself stays unenforced here and is checked in the parser instead. `.meta()`
                    // only annotates the JSON Schema `toToolInputSchema()` derives; it adds no
                    // runtime check, so it can restore this maxLength without also mismeasuring it.
                    newText: z
                      .string()
                      .describe("Replacement text.")
                      .meta({ maxLength: maxProposedWorkspaceEditReplacementCharacters }),
                  })
                  .describe("One replacement over a half-open text range."),
              )
              .min(1)
              .max(maxProposedWorkspaceEditEdits)
              .describe("Non-overlapping text edits for this file."),
          })
          .describe("One existing workspace file and its non-overlapping edits."),
      )
      .min(minProposedWorkspaceEditFiles)
      .max(maxProposedWorkspaceEditFiles)
      .describe("At least two existing files with non-overlapping edits."),
  })
  .refine((value) => new Set(value.files.map((file) => file.path)).size === value.files.length, {
    message: "propose_workspace_edit targets must be distinct.",
    path: ["files"],
  });

export const proposeWorkspaceEditInputSchema = toToolInputSchema(proposeWorkspaceEditZodSchema);

export interface ProposeWorkspaceEditFileInput {
  readonly path: string;
  readonly edits: readonly TextEdit[];
}

export interface ProposeWorkspaceEditInput {
  readonly files: readonly ProposeWorkspaceEditFileInput[];
}

export interface ProposeWorkspaceEditWorkspace extends ProposeFileEditWorkspace {}

export class StaleWorkspaceEditTargetError extends Error {
  constructor() {
    super("A workspace edit target changed before its proposal could be created.");
    this.name = "StaleWorkspaceEditTargetError";
  }
}

export function createProposeWorkspaceEditTool(
  workspace: ProposeWorkspaceEditWorkspace,
): AgentTool<ProposeWorkspaceEditInput, WorkspaceEditPlan> {
  return {
    name: proposeWorkspaceEditToolName,
    description: proposeWorkspaceEditToolDescription,
    inputSchema: proposeWorkspaceEditInputSchema,
    risk: "write",
    parseInput: parseProposeWorkspaceEditInput,
    execute: prepareWorkspaceEditApproval(workspace),
    prepareApproval: prepareWorkspaceEditApproval(workspace),
  };
}

function prepareWorkspaceEditApproval(workspace: ProposeWorkspaceEditWorkspace) {
  return async (
    input: ProposeWorkspaceEditInput,
    { signal }: { readonly signal: AbortSignal },
  ): Promise<ToolExecutionOutput<WorkspaceEditPlan>> => {
    signal.throwIfAborted();
    const files = [];
    for (const file of input.files) {
      signal.throwIfAborted();
      const snapshot = parseFileEditRevisionSnapshot(
        await workspace.captureFileRevision({ path: file.path }, signal),
      );
      signal.throwIfAborted();
      const current = await workspace.isFileRevisionCurrent(snapshot, signal);
      signal.throwIfAborted();
      if (typeof current !== "boolean") {
        throw new InvalidWorkspaceFileRevisionError();
      }
      if (!current) {
        throw new StaleWorkspaceEditTargetError();
      }
      files.push({
        path: file.path,
        uri: snapshot.uri,
        originalRevision: snapshot.revision,
        edits: file.edits,
      });
    }

    try {
      return {
        output: parseWorkspaceEditPlan({ operation: "edit", files }),
        truncated: false,
      };
    } catch (error) {
      if (error instanceof InvalidWorkspaceEditPlanError) {
        throw new TypeError("Invalid workspace edit proposal.");
      }
      throw error;
    }
  };
}

function parseProposeWorkspaceEditInput(value: unknown): ProposeWorkspaceEditInput {
  const parsed = proposeWorkspaceEditZodSchema.parse(value);

  let aggregateReplacementBytes = 0;
  const files = parsed.files.map((candidate) => {
    let edits: readonly TextEdit[];
    try {
      edits = parseTextEdits(candidate.edits);
    } catch {
      throw new TypeError("Invalid propose_workspace_edit edits.");
    }
    for (const edit of edits) {
      if (!isBoundedWorkspaceEditText(edit.newText)) {
        throw new TypeError("propose_workspace_edit replacement is too large.");
      }
      aggregateReplacementBytes += utf8ByteLength(edit.newText);
      if (aggregateReplacementBytes > maxTotalProposedWorkspaceEditReplacementBytes) {
        throw new TypeError("propose_workspace_edit replacements are too large.");
      }
    }

    return { path: candidate.path, edits };
  });

  return { files };
}
