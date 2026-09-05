import {
  type AgentTool,
  type FileDeletePlan,
  maxApprovalUriCharacters,
  maxFileDeleteContentBytes,
  maxFileDeleteContentCharacters,
  maxFileDeleteContentLines,
  maxFileDeletePathBytes,
  parseFileDeletePlan,
  type ToolExecutionOutput,
} from "@ctrl-zebra/core";
import { checkpointHashSchema, utf8ByteLength } from "@ctrl-zebra/protocol";

import { hasOnlyKeys, isRecord, isSafeForwardSlashPath } from "./boundary-validation.js";

export const proposeFileDeleteToolName = "propose_file_delete" as const;
export const proposeFileDeleteToolDescription =
  "Propose deletion of one bounded UTF-8 text file in the selected workspace; deletion applies only after explicit user approval.";

export const maxProposedFileDeleteCharacters = maxFileDeleteContentCharacters;
export const maxProposedFileDeleteLines = maxFileDeleteContentLines;
export const maxProposedFileDeleteBytes = maxFileDeleteContentBytes;
export const maxProposedFileDeletePathBytes = maxFileDeletePathBytes;

export const proposeFileDeleteInputSchema = {
  type: "object",
  properties: {
    path: {
      type: "string",
      description: "Workspace-relative file path using forward slashes.",
      minLength: 1,
      maxLength: 4_096,
      pattern: "^(?!/)(?!.*(?:^|/)\\.{1,2}(?:/|$))(?!.*\\\\).+$",
    },
  },
  required: ["path"],
  additionalProperties: false,
} as const;

export interface ProposeFileDeleteInput {
  readonly path: string;
}

export interface FileDeleteTargetSnapshot {
  readonly path: string;
  readonly uri: string;
  readonly beforeContent: string;
  readonly beforeHash: string;
}

export interface ProposeFileDeleteWorkspace {
  readonly hashText: (text: string) => string;
  captureFileDeleteTarget(request: ProposeFileDeleteInput, signal: AbortSignal): Promise<unknown>;
  isFileDeleteTargetCurrent(
    snapshot: FileDeleteTargetSnapshot,
    signal: AbortSignal,
  ): Promise<unknown>;
}

export class InvalidWorkspaceFileDeleteTargetError extends Error {
  constructor() {
    super("Workspace returned invalid file-delete target data.");
    this.name = "InvalidWorkspaceFileDeleteTargetError";
  }
}

export class FileDeleteTargetNotFoundError extends Error {
  constructor() {
    super("The target file does not exist or is not a text file.");
    this.name = "FileDeleteTargetNotFoundError";
  }
}

export { FileDeleteTargetNotFoundError as FileDeleteTargetMissingError };

export class StaleFileDeleteTargetError extends Error {
  constructor() {
    super("The target file changed before its deletion proposal could be created.");
    this.name = "StaleFileDeleteTargetError";
  }
}

export function createProposeFileDeleteTool(
  workspace: ProposeFileDeleteWorkspace,
): AgentTool<ProposeFileDeleteInput, FileDeletePlan> {
  return {
    name: proposeFileDeleteToolName,
    description: proposeFileDeleteToolDescription,
    inputSchema: proposeFileDeleteInputSchema,
    risk: "write",
    parseInput: parseProposeFileDeleteInput,
    execute: prepareFileDeleteApproval(workspace),
    prepareApproval: prepareFileDeleteApproval(workspace),
  };
}

function prepareFileDeleteApproval(workspace: ProposeFileDeleteWorkspace) {
  return async (
    input: ProposeFileDeleteInput,
    { signal }: { readonly signal: AbortSignal },
  ): Promise<ToolExecutionOutput<FileDeletePlan>> => {
    signal.throwIfAborted();
    const value = await workspace.captureFileDeleteTarget(input, signal);
    signal.throwIfAborted();
    const snapshot = parseFileDeleteTargetSnapshot(value);
    const current = await workspace.isFileDeleteTargetCurrent(snapshot, signal);
    signal.throwIfAborted();
    if (typeof current !== "boolean") {
      throw new InvalidWorkspaceFileDeleteTargetError();
    }
    if (!current) {
      throw new StaleFileDeleteTargetError();
    }

    return {
      output: parseFileDeletePlan(
        {
          operation: "delete",
          path: snapshot.path,
          uri: snapshot.uri,
          beforeContent: snapshot.beforeContent,
          beforeHash: snapshot.beforeHash,
        },
        workspace.hashText,
      ),
      truncated: false,
    };
  };
}

function parseProposeFileDeleteInput(value: unknown): ProposeFileDeleteInput {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, new Set(["path"])) ||
    !isSafeForwardSlashPath(value.path, {
      maxLength: 4_096,
      allowLeadingSlash: false,
      rejectCurrentSegments: true,
    }) ||
    utf8ByteLength(value.path) > maxProposedFileDeletePathBytes
  ) {
    throw new TypeError("Invalid propose_file_delete input.");
  }

  return { path: value.path };
}

function parseFileDeleteTargetSnapshot(value: unknown): FileDeleteTargetSnapshot {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, new Set(["path", "uri", "beforeContent", "beforeHash"])) ||
    !isSafeForwardSlashPath(value.path, {
      maxLength: 4_096,
      allowLeadingSlash: false,
      rejectCurrentSegments: true,
    }) ||
    utf8ByteLength(value.path) > maxProposedFileDeletePathBytes ||
    typeof value.uri !== "string" ||
    value.uri.length === 0 ||
    value.uri.length > maxApprovalUriCharacters ||
    typeof value.beforeContent !== "string" ||
    !isBoundedText(value.beforeContent) ||
    !checkpointHashSchema.safeParse(value.beforeHash).success
  ) {
    throw new InvalidWorkspaceFileDeleteTargetError();
  }

  return {
    path: value.path as string,
    uri: value.uri as string,
    beforeContent: value.beforeContent as string,
    beforeHash: value.beforeHash as string,
  };
}

function isBoundedText(text: string): boolean {
  return (
    text.isWellFormed() &&
    !text.includes("\0") &&
    [...text].length <= maxProposedFileDeleteCharacters &&
    countLogicalLines(text) <= maxProposedFileDeleteLines &&
    utf8ByteLength(text) <= maxProposedFileDeleteBytes
  );
}

function countLogicalLines(text: string): number {
  return text.length === 0 ? 0 : text.split(/\r\n|\r|\n/u).length;
}
