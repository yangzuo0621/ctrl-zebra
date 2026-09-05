import {
  type AgentTool,
  type ApprovalResourceRevision,
  approvalResourceRevisionSchema,
  maxApprovalUriCharacters,
  maxTextEdits,
  parseTextEditPlan,
  parseTextEdits,
  type TextEdit,
  type TextEditPlan,
  type ToolExecutionOutput,
} from "@ctrl-zebra/core";
import { utf8ByteLength } from "@ctrl-zebra/protocol";
import { z } from "zod";

import { hasOnlyKeys, isRecord } from "./boundary-validation.js";
import { textRangeSchema } from "./text-edit-schema.js";
import { workspaceRelativePathSchema } from "./workspace-path-schema.js";
import { toToolInputSchema } from "./zod-tool-schema.js";

export const proposeFileEditToolName = "propose_file_edit" as const;
export const proposeFileEditToolDescription =
  "Propose bounded text edits for one selected-workspace file; changes apply only after explicit user approval.";
export const maxProposedFileEdits = maxTextEdits;
export const maxProposedReplacementCharacters = 262_144;
export const maxTotalProposedReplacementBytes = 786_432;

const proposeFileEditZodSchema = z.strictObject({
  path: workspaceRelativePathSchema("Workspace-relative file path using forward slashes."),
  edits: z
    .array(
      z
        .strictObject({
          range: textRangeSchema,
          newText: z.string().max(maxProposedReplacementCharacters).describe("Replacement text."),
        })
        .describe("One replacement over a half-open text range."),
    )
    .min(1)
    .max(maxProposedFileEdits)
    .describe("Non-overlapping text edits for the file."),
});
export const proposeFileEditInputSchema = toToolInputSchema(proposeFileEditZodSchema);

export interface ProposeFileEditInput {
  readonly path: string;
  readonly edits: readonly TextEdit[];
}

export interface FileEditRevisionSnapshot {
  readonly uri: string;
  readonly revision: ApprovalResourceRevision;
}

export interface CaptureFileEditRevisionRequest {
  readonly path: string;
}

export interface ProposeFileEditWorkspace {
  captureFileRevision(
    request: CaptureFileEditRevisionRequest,
    signal: AbortSignal,
  ): Promise<unknown>;
  isFileRevisionCurrent(snapshot: FileEditRevisionSnapshot, signal: AbortSignal): Promise<unknown>;
}

export class InvalidWorkspaceFileRevisionError extends Error {
  constructor() {
    super("Workspace returned invalid file revision data.");
    this.name = "InvalidWorkspaceFileRevisionError";
  }
}

export class StaleFileRevisionError extends Error {
  constructor() {
    super("The target file changed before its edit proposal could be created.");
    this.name = "StaleFileRevisionError";
  }
}

export function createProposeFileEditTool(
  workspace: ProposeFileEditWorkspace,
): AgentTool<ProposeFileEditInput, TextEditPlan> {
  return {
    name: proposeFileEditToolName,
    description: proposeFileEditToolDescription,
    inputSchema: proposeFileEditInputSchema,
    risk: "write",
    parseInput: parseProposeFileEditInput,
    execute: prepareFileEditApproval(workspace),
    prepareApproval: prepareFileEditApproval(workspace),
  };
}

function prepareFileEditApproval(workspace: ProposeFileEditWorkspace) {
  return async (
    input: ProposeFileEditInput,
    { signal }: { readonly signal: AbortSignal },
  ): Promise<ToolExecutionOutput<TextEditPlan>> => {
    signal.throwIfAborted();
    const value = await workspace.captureFileRevision({ path: input.path }, signal);
    signal.throwIfAborted();
    const snapshot = parseFileEditRevisionSnapshot(value);
    const current = await workspace.isFileRevisionCurrent(snapshot, signal);
    signal.throwIfAborted();

    if (typeof current !== "boolean") {
      throw new InvalidWorkspaceFileRevisionError();
    }
    if (!current) {
      throw new StaleFileRevisionError();
    }

    return {
      output: parseTextEditPlan({
        uri: snapshot.uri,
        originalRevision: snapshot.revision,
        edits: input.edits,
      }),
      truncated: false,
    };
  };
}

function parseProposeFileEditInput(value: unknown): ProposeFileEditInput {
  const parsed = proposeFileEditZodSchema.parse(value);

  let edits: readonly TextEdit[];
  try {
    edits = parseTextEdits(parsed.edits);
  } catch {
    throw new TypeError("Invalid propose_file_edit edits.");
  }

  let replacementBytes = 0;
  for (const edit of edits) {
    replacementBytes += utf8ByteLength(edit.newText);
    if (replacementBytes > maxTotalProposedReplacementBytes) {
      throw new TypeError("propose_file_edit replacements are too large.");
    }
  }

  return { path: parsed.path, edits };
}

export function parseFileEditRevisionSnapshot(value: unknown): FileEditRevisionSnapshot {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, new Set(["uri", "revision"])) ||
    typeof value.uri !== "string" ||
    value.uri.length === 0 ||
    value.uri.length > maxApprovalUriCharacters
  ) {
    throw new InvalidWorkspaceFileRevisionError();
  }

  const revision = approvalResourceRevisionSchema.safeParse(value.revision);
  if (!revision.success) {
    throw new InvalidWorkspaceFileRevisionError();
  }

  return { uri: value.uri, revision: revision.data };
}
