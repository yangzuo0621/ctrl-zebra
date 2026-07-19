import {
  type AgentTool,
  type ApprovalResourceRevision,
  approvalResourceRevisionSchema,
  maxApprovalUriCharacters,
  parseTextEditPlan,
  parseTextEdits,
  type TextEdit,
  type TextEditPlan,
  type ToolExecutionOutput,
} from "@ctrl-zebra/core";

import { hasOnlyKeys, isRecord, isSafeForwardSlashPath } from "./boundary-validation.js";

export const proposeFileEditToolName = "propose_file_edit" as const;
export const proposeFileEditToolDescription =
  "Propose bounded text edits for one file in the selected workspace without applying them.";
export const maxProposedFileEdits = 256;
export const maxProposedReplacementCharacters = 262_144;
export const maxTotalProposedReplacementBytes = 786_432;

const positionInputSchema = {
  type: "object",
  description: "A zero-based text position.",
  properties: {
    line: {
      type: "integer",
      description: "Zero-based line number.",
      minimum: 0,
    },
    character: {
      type: "integer",
      description: "Zero-based UTF-16 character offset.",
      minimum: 0,
    },
  },
  required: ["line", "character"],
  additionalProperties: false,
} as const;

export const proposeFileEditInputSchema = {
  type: "object",
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
      description: "Non-overlapping text edits for the file.",
      minItems: 1,
      maxItems: maxProposedFileEdits,
      items: {
        type: "object",
        description: "One replacement over a half-open text range.",
        properties: {
          range: {
            type: "object",
            description: "A zero-based half-open text range.",
            properties: {
              start: positionInputSchema,
              end: positionInputSchema,
            },
            required: ["start", "end"],
            additionalProperties: false,
          },
          newText: {
            type: "string",
            description: "Replacement text.",
            maxLength: maxProposedReplacementCharacters,
          },
        },
        required: ["range", "newText"],
        additionalProperties: false,
      },
    },
  },
  required: ["path", "edits"],
  additionalProperties: false,
} as const;

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
    async execute(input, { signal }): Promise<ToolExecutionOutput<TextEditPlan>> {
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
    },
  };
}

function parseProposeFileEditInput(value: unknown): ProposeFileEditInput {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, new Set(["path", "edits"])) ||
    !isSafeForwardSlashPath(value.path, {
      maxLength: 4_096,
      allowLeadingSlash: false,
      rejectCurrentSegments: true,
    }) ||
    !Array.isArray(value.edits) ||
    value.edits.length > maxProposedFileEdits
  ) {
    throw new TypeError("Invalid propose_file_edit input.");
  }

  let edits: readonly TextEdit[];
  try {
    edits = parseTextEdits(value.edits);
  } catch {
    throw new TypeError("Invalid propose_file_edit edits.");
  }
  let replacementBytes = 0;
  for (const edit of edits) {
    if (edit.newText.length > maxProposedReplacementCharacters) {
      throw new TypeError("propose_file_edit replacement is too large.");
    }

    replacementBytes += new TextEncoder().encode(edit.newText).byteLength;
    if (replacementBytes > maxTotalProposedReplacementBytes) {
      throw new TypeError("propose_file_edit replacements are too large.");
    }
  }

  return { path: value.path, edits };
}

function parseFileEditRevisionSnapshot(value: unknown): FileEditRevisionSnapshot {
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
