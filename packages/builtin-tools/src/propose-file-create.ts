import {
  type AgentTool,
  type FileCreatePlan,
  maxApprovalUriCharacters,
  parseFileCreatePlan,
  type ToolExecutionOutput,
} from "@ctrl-zebra/core";
import { checkpointHashSchema } from "@ctrl-zebra/protocol";

import { hasOnlyKeys, isRecord, isSafeForwardSlashPath } from "./boundary-validation.js";
import { utf8ByteLength } from "./text-primitives.js";

export const proposeFileCreateToolName = "propose_file_create" as const;
export const proposeFileCreateToolDescription =
  "Propose a bounded UTF-8 text file in the selected workspace; creation applies only after explicit user approval.";

export const maxProposedFileCreateCharacters = 65_536;
export const maxProposedFileCreateLines = 2_000;
export const maxProposedFileCreateBytes = 262_144;
export const maxProposedFileCreatePathBytes = 16_384;

export const proposeFileCreateInputSchema = {
  type: "object",
  properties: {
    path: {
      type: "string",
      description: "Workspace-relative file path using forward slashes.",
      minLength: 1,
      maxLength: 4_096,
      pattern: "^(?!/)(?!.*(?:^|/)\\.{1,2}(?:/|$))(?!.*\\\\).+$",
    },
    content: {
      type: "string",
      description: "Complete UTF-8 text content for the new file.",
      maxLength: maxProposedFileCreateCharacters,
    },
  },
  required: ["path", "content"],
  additionalProperties: false,
} as const;

export interface ProposeFileCreateInput {
  readonly path: string;
  readonly content: string;
}

export interface FileCreateTargetSnapshot {
  readonly path: string;
  readonly uri: string;
  readonly afterHash: string;
}

export interface CaptureFileCreateTargetRequest extends ProposeFileCreateInput {}

export interface ProposeFileCreateWorkspace {
  captureFileCreateTarget(
    request: CaptureFileCreateTargetRequest,
    signal: AbortSignal,
  ): Promise<unknown>;
  isFileCreateTargetAbsent(
    snapshot: FileCreateTargetSnapshot,
    signal: AbortSignal,
  ): Promise<unknown>;
}

export class InvalidWorkspaceFileCreateTargetError extends Error {
  constructor() {
    super("Workspace returned invalid file-create target data.");
    this.name = "InvalidWorkspaceFileCreateTargetError";
  }
}

export class FileCreateTargetExistsError extends Error {
  constructor() {
    super("The target file already exists.");
    this.name = "FileCreateTargetExistsError";
  }
}

export class StaleFileCreateTargetError extends Error {
  constructor() {
    super("The target file appeared before its creation proposal could be prepared.");
    this.name = "StaleFileCreateTargetError";
  }
}

export function createProposeFileCreateTool(
  workspace: ProposeFileCreateWorkspace,
): AgentTool<ProposeFileCreateInput, FileCreatePlan> {
  return {
    name: proposeFileCreateToolName,
    description: proposeFileCreateToolDescription,
    inputSchema: proposeFileCreateInputSchema,
    risk: "write",
    parseInput: parseProposeFileCreateInput,
    execute: prepareFileCreateApproval(workspace),
    prepareApproval: prepareFileCreateApproval(workspace),
  };
}

function prepareFileCreateApproval(workspace: ProposeFileCreateWorkspace) {
  return async (
    input: ProposeFileCreateInput,
    { signal }: { readonly signal: AbortSignal },
  ): Promise<ToolExecutionOutput<FileCreatePlan>> => {
    signal.throwIfAborted();
    const value = await workspace.captureFileCreateTarget(input, signal);
    signal.throwIfAborted();
    const snapshot = parseFileCreateTargetSnapshot(value);
    const absent = await workspace.isFileCreateTargetAbsent(snapshot, signal);
    signal.throwIfAborted();
    if (typeof absent !== "boolean") {
      throw new InvalidWorkspaceFileCreateTargetError();
    }
    if (!absent) {
      throw new StaleFileCreateTargetError();
    }

    return {
      output: parseFileCreatePlan({
        operation: "create",
        path: snapshot.path,
        uri: snapshot.uri,
        content: input.content,
        afterHash: snapshot.afterHash,
      }),
      truncated: false,
    };
  };
}

function parseProposeFileCreateInput(value: unknown): ProposeFileCreateInput {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, new Set(["path", "content"])) ||
    !isSafeForwardSlashPath(value.path, {
      maxLength: 4_096,
      allowLeadingSlash: false,
      rejectCurrentSegments: true,
    }) ||
    !isSafePathSize(value.path) ||
    typeof value.content !== "string"
  ) {
    throw new TypeError("Invalid propose_file_create input.");
  }

  if (!isBoundedText(value.content)) {
    throw new TypeError("propose_file_create content is too large or not UTF-8 text.");
  }

  return { path: value.path, content: value.content };
}

function parseFileCreateTargetSnapshot(value: unknown): FileCreateTargetSnapshot {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, new Set(["path", "uri", "afterHash"])) ||
    !isSafeForwardSlashPath(value.path, {
      maxLength: 4_096,
      allowLeadingSlash: false,
      rejectCurrentSegments: true,
    }) ||
    !isSafePathSize(value.path) ||
    typeof value.uri !== "string" ||
    value.uri.length === 0 ||
    value.uri.length > maxApprovalUriCharacters ||
    !checkpointHashSchema.safeParse(value.afterHash).success
  ) {
    throw new InvalidWorkspaceFileCreateTargetError();
  }

  return {
    path: value.path as string,
    uri: value.uri as string,
    afterHash: value.afterHash as string,
  };
}

function isSafePathSize(path: string): boolean {
  return [...path].length <= 4_096 && utf8ByteLength(path) <= maxProposedFileCreatePathBytes;
}

function isBoundedText(text: string): boolean {
  return (
    !text.includes("\0") &&
    text.isWellFormed() &&
    [...text].length <= maxProposedFileCreateCharacters &&
    countLogicalLines(text) <= maxProposedFileCreateLines &&
    utf8ByteLength(text) <= maxProposedFileCreateBytes
  );
}

function countLogicalLines(text: string): number {
  return text.length === 0 ? 0 : text.split(/\r\n|\r|\n/u).length;
}
