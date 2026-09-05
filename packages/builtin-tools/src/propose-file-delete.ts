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
import { z } from "zod";
import { hasOnlyKeys, isRecord, isSafeForwardSlashPath } from "./boundary-validation.js";
import { isBoundedWorkspaceText } from "./bounded-text-schema.js";
import { workspaceRelativePathSchema } from "./workspace-path-schema.js";
import { toToolInputSchema } from "./zod-tool-schema.js";

export const proposeFileDeleteToolName = "propose_file_delete" as const;
export const proposeFileDeleteToolDescription =
  "Propose deletion of one bounded UTF-8 text file in the selected workspace; deletion applies only after explicit user approval.";

export const maxProposedFileDeleteCharacters = maxFileDeleteContentCharacters;
export const maxProposedFileDeleteLines = maxFileDeleteContentLines;
export const maxProposedFileDeleteBytes = maxFileDeleteContentBytes;
export const maxProposedFileDeletePathBytes = maxFileDeletePathBytes;

const proposeFileDeleteZodSchema = z.strictObject({
  path: workspaceRelativePathSchema(
    "Workspace-relative file path using forward slashes.",
    4_096,
    maxProposedFileDeletePathBytes,
  ),
});
export const proposeFileDeleteInputSchema = toToolInputSchema(proposeFileDeleteZodSchema);

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
  return proposeFileDeleteZodSchema.parse(value);
}

function parseFileDeleteTargetSnapshot(value: unknown): FileDeleteTargetSnapshot {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, new Set(["path", "uri", "beforeContent", "beforeHash"])) ||
    !isSafePath(value.path) ||
    typeof value.uri !== "string" ||
    value.uri.length === 0 ||
    value.uri.length > maxApprovalUriCharacters ||
    typeof value.beforeContent !== "string" ||
    !isBoundedWorkspaceText(value.beforeContent, {
      maxCharacters: maxProposedFileDeleteCharacters,
      maxLines: maxProposedFileDeleteLines,
      maxBytes: maxProposedFileDeleteBytes,
    }) ||
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

// Host-snapshot validation, not model input, so it stays a plain predicate rather than a zod
// schema -- see bounded-text-schema.ts's docs.
function isSafePath(value: unknown): value is string {
  return (
    isSafeForwardSlashPath(value, {
      maxLength: 4_096,
      allowLeadingSlash: false,
      rejectCurrentSegments: true,
    }) && utf8ByteLength(value) <= maxProposedFileDeletePathBytes
  );
}
