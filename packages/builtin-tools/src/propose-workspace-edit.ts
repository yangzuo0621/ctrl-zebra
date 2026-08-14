import {
  type AgentTool,
  InvalidWorkspaceEditPlanError,
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

import { hasOnlyKeys, isRecord, isSafeForwardSlashPath } from "./boundary-validation.js";
import {
  InvalidWorkspaceFileRevisionError,
  type ProposeFileEditWorkspace,
  parseFileEditRevisionSnapshot,
} from "./propose-file-edit.js";
import { utf8ByteLength } from "./text-primitives.js";

export const proposeWorkspaceEditToolName = "propose_workspace_edit" as const;
export const proposeWorkspaceEditToolDescription =
  "Propose bounded text edits across multiple selected-workspace files; changes apply atomically only after explicit user approval.";

export const maxProposedWorkspaceEditFiles = maxWorkspaceEditFiles;
export const minProposedWorkspaceEditFiles = minWorkspaceEditFiles;
export const maxProposedWorkspaceEditReplacementCharacters = maxWorkspaceEditReplacementCharacters;
export const maxProposedWorkspaceEditReplacementBytes = maxWorkspaceEditReplacementBytes;
export const maxTotalProposedWorkspaceEditReplacementBytes =
  maxWorkspaceEditAggregateReplacementBytes;
export const maxProposedWorkspaceEditPathBytes = maxWorkspaceEditPathBytes;

const positionInputSchema = {
  type: "object",
  description: "A zero-based text position.",
  properties: {
    line: { type: "integer", description: "Zero-based line number.", minimum: 0 },
    character: { type: "integer", description: "Zero-based UTF-16 character offset.", minimum: 0 },
  },
  required: ["line", "character"],
  additionalProperties: false,
} as const;

const editInputSchema = {
  type: "object",
  description: "One replacement over a half-open text range.",
  properties: {
    range: {
      type: "object",
      description: "A zero-based half-open text range.",
      properties: { start: positionInputSchema, end: positionInputSchema },
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
} as const;

export const proposeWorkspaceEditInputSchema = {
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
            pattern: "^(?!/)(?!.*(?:^|/)\\.{1,2}(?:/|$))(?!.*\\\\).+$",
          },
          edits: {
            type: "array",
            description: "Non-overlapping text edits for this file.",
            minItems: 1,
            items: editInputSchema,
          },
        },
        required: ["path", "edits"],
        additionalProperties: false,
      },
    },
  },
  required: ["files"],
  additionalProperties: false,
} as const;

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
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, new Set(["files"])) ||
    !Array.isArray(value.files) ||
    value.files.length < minProposedWorkspaceEditFiles ||
    value.files.length > maxProposedWorkspaceEditFiles
  ) {
    throw new TypeError("Invalid propose_workspace_edit input.");
  }

  const paths = new Set<string>();
  let aggregateReplacementBytes = 0;
  const files = value.files.map((candidate) => {
    if (
      !isRecord(candidate) ||
      !hasOnlyKeys(candidate, new Set(["path", "edits"])) ||
      !isSafeForwardSlashPath(candidate.path, {
        maxLength: 4_096,
        allowLeadingSlash: false,
        rejectCurrentSegments: true,
      }) ||
      utf8ByteLength(candidate.path) > maxProposedWorkspaceEditPathBytes ||
      !Array.isArray(candidate.edits) ||
      candidate.edits.length === 0
    ) {
      throw new TypeError("Invalid propose_workspace_edit file input.");
    }

    const path = candidate.path;
    if (paths.has(path)) {
      throw new TypeError("propose_workspace_edit targets must be distinct.");
    }
    paths.add(path);

    let edits: readonly TextEdit[];
    try {
      edits = parseTextEdits(candidate.edits);
    } catch {
      throw new TypeError("Invalid propose_workspace_edit edits.");
    }
    for (const edit of edits) {
      if (
        !edit.newText.isWellFormed() ||
        edit.newText.includes("\0") ||
        [...edit.newText].length > maxProposedWorkspaceEditReplacementCharacters ||
        utf8ByteLength(edit.newText) > maxProposedWorkspaceEditReplacementBytes
      ) {
        throw new TypeError("propose_workspace_edit replacement is too large.");
      }
      aggregateReplacementBytes += utf8ByteLength(edit.newText);
      if (aggregateReplacementBytes > maxTotalProposedWorkspaceEditReplacementBytes) {
        throw new TypeError("propose_workspace_edit replacements are too large.");
      }
    }

    return { path, edits };
  });

  return { files };
}
