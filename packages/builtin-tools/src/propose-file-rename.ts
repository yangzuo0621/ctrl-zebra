import {
  type AgentTool,
  type FileRenamePlan,
  maxApprovalUriCharacters,
  maxFileRenameContentBytes,
  maxFileRenameContentCharacters,
  maxFileRenameContentLines,
  maxFileRenamePathBytes,
  parseFileRenamePlan,
  type ToolExecutionOutput,
} from "@ctrl-zebra/core";
import { checkpointHashSchema, utf8ByteLength } from "@ctrl-zebra/protocol";
import { z } from "zod";
import { hasOnlyKeys, isRecord, isSafeForwardSlashPath } from "./boundary-validation.js";
import { isBoundedWorkspaceText } from "./bounded-text-schema.js";
import { workspaceRelativePathSchema } from "./workspace-path-schema.js";
import { toToolInputSchema } from "./zod-tool-schema.js";

export const proposeFileRenameToolName = "propose_file_rename" as const;
export const proposeFileRenameToolDescription =
  "Propose moving one bounded UTF-8 text file within the selected workspace; renaming applies only after explicit user approval and never overwrites a target.";

export const maxProposedFileRenameCharacters = maxFileRenameContentCharacters;
export const maxProposedFileRenameLines = maxFileRenameContentLines;
export const maxProposedFileRenameBytes = maxFileRenameContentBytes;
export const maxProposedFileRenamePathBytes = maxFileRenamePathBytes;

const proposeFileRenameZodSchema = z
  .strictObject({
    sourcePath: workspaceRelativePathSchema(
      "Workspace-relative existing file path using forward slashes.",
      4_096,
      maxProposedFileRenamePathBytes,
    ),
    targetPath: workspaceRelativePathSchema(
      "Workspace-relative absent destination path using forward slashes.",
      4_096,
      maxProposedFileRenamePathBytes,
    ),
  })
  .refine((value) => value.sourcePath !== value.targetPath, {
    message: "propose_file_rename sourcePath and targetPath must differ.",
    path: ["targetPath"],
  });
export const proposeFileRenameInputSchema = toToolInputSchema(proposeFileRenameZodSchema);

export interface ProposeFileRenameInput {
  readonly sourcePath: string;
  readonly targetPath: string;
}

export interface FileRenameTargetSnapshot {
  readonly sourcePath: string;
  readonly targetPath: string;
  readonly sourceUri: string;
  readonly targetUri: string;
  readonly beforeContent: string;
  readonly beforeHash: string;
}

export interface ProposeFileRenameWorkspace {
  readonly hashText: (text: string) => string;
  captureFileRenameTarget(request: ProposeFileRenameInput, signal: AbortSignal): Promise<unknown>;
  isFileRenameTargetCurrent(
    snapshot: FileRenameTargetSnapshot,
    signal: AbortSignal,
  ): Promise<unknown>;
}

export class InvalidWorkspaceFileRenameTargetError extends Error {
  constructor() {
    super("Workspace returned invalid file-rename target data.");
    this.name = "InvalidWorkspaceFileRenameTargetError";
  }
}

export class FileRenameSourceNotFoundError extends Error {
  constructor() {
    super("The rename source does not exist or is not a text file.");
    this.name = "FileRenameSourceNotFoundError";
  }
}

export { FileRenameSourceNotFoundError as FileRenameSourceMissingError };

export class FileRenameTargetExistsError extends Error {
  constructor() {
    super("The rename target already exists.");
    this.name = "FileRenameTargetExistsError";
  }
}

export class StaleFileRenameTargetError extends Error {
  constructor() {
    super("The rename source or target changed before its proposal could be created.");
    this.name = "StaleFileRenameTargetError";
  }
}

export function createProposeFileRenameTool(
  workspace: ProposeFileRenameWorkspace,
): AgentTool<ProposeFileRenameInput, FileRenamePlan> {
  return {
    name: proposeFileRenameToolName,
    description: proposeFileRenameToolDescription,
    inputSchema: proposeFileRenameInputSchema,
    risk: "write",
    parseInput: parseProposeFileRenameInput,
    execute: prepareFileRenameApproval(workspace),
    prepareApproval: prepareFileRenameApproval(workspace),
  };
}

function prepareFileRenameApproval(workspace: ProposeFileRenameWorkspace) {
  return async (
    input: ProposeFileRenameInput,
    { signal }: { readonly signal: AbortSignal },
  ): Promise<ToolExecutionOutput<FileRenamePlan>> => {
    signal.throwIfAborted();
    const value = await workspace.captureFileRenameTarget(input, signal);
    signal.throwIfAborted();
    const snapshot = parseFileRenameTargetSnapshot(value);
    const current = await workspace.isFileRenameTargetCurrent(snapshot, signal);
    signal.throwIfAborted();
    if (typeof current !== "boolean") {
      throw new InvalidWorkspaceFileRenameTargetError();
    }
    if (!current) {
      throw new StaleFileRenameTargetError();
    }

    return {
      output: parseFileRenamePlan(
        {
          operation: "rename",
          sourcePath: snapshot.sourcePath,
          targetPath: snapshot.targetPath,
          sourceUri: snapshot.sourceUri,
          targetUri: snapshot.targetUri,
          beforeContent: snapshot.beforeContent,
          beforeHash: snapshot.beforeHash,
        },
        workspace.hashText,
      ),
      truncated: false,
    };
  };
}

function parseProposeFileRenameInput(value: unknown): ProposeFileRenameInput {
  return proposeFileRenameZodSchema.parse(value);
}

function parseFileRenameTargetSnapshot(value: unknown): FileRenameTargetSnapshot {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(
      value,
      new Set([
        "sourcePath",
        "targetPath",
        "sourceUri",
        "targetUri",
        "beforeContent",
        "beforeHash",
      ]),
    ) ||
    !isSafePath(value.sourcePath) ||
    !isSafePath(value.targetPath) ||
    value.sourcePath === value.targetPath ||
    typeof value.sourceUri !== "string" ||
    value.sourceUri.length === 0 ||
    value.sourceUri.length > maxApprovalUriCharacters ||
    typeof value.targetUri !== "string" ||
    value.targetUri.length === 0 ||
    value.targetUri.length > maxApprovalUriCharacters ||
    value.sourceUri === value.targetUri ||
    typeof value.beforeContent !== "string" ||
    !isBoundedWorkspaceText(value.beforeContent, {
      maxCharacters: maxProposedFileRenameCharacters,
      maxLines: maxProposedFileRenameLines,
      maxBytes: maxProposedFileRenameBytes,
    }) ||
    !checkpointHashSchema.safeParse(value.beforeHash).success
  ) {
    throw new InvalidWorkspaceFileRenameTargetError();
  }

  return {
    sourcePath: value.sourcePath as string,
    targetPath: value.targetPath as string,
    sourceUri: value.sourceUri as string,
    targetUri: value.targetUri as string,
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
    }) && utf8ByteLength(value) <= maxProposedFileRenamePathBytes
  );
}
