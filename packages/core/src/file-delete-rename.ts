import {
  checkpointHashSchema,
  maxApprovalUriCharacters,
  utf8ByteLength,
} from "@ctrl-zebra/protocol";
import {
  maxFileCreateContentBytes,
  maxFileCreateContentCharacters,
  maxFileCreateContentLines,
  maxFileCreatePathBytes,
  maxFileCreatePathCharacters,
} from "./file-create.js";
import { hasExactKeys, isRecord } from "./record-validation.js";
import { isSafeWorkspacePath } from "./workspace-path.js";

export const maxFileDeletePathCharacters = maxFileCreatePathCharacters;
export const maxFileDeletePathBytes = maxFileCreatePathBytes;
export const maxFileDeleteContentCharacters = maxFileCreateContentCharacters;
export const maxFileDeleteContentLines = maxFileCreateContentLines;
export const maxFileDeleteContentBytes = maxFileCreateContentBytes;

export const maxFileRenamePathCharacters = maxFileCreatePathCharacters;
export const maxFileRenamePathBytes = maxFileCreatePathBytes;
export const maxFileRenameContentCharacters = maxFileCreateContentCharacters;
export const maxFileRenameContentLines = maxFileCreateContentLines;
export const maxFileRenameContentBytes = maxFileCreateContentBytes;

/** The immutable host-bound plan prepared for deleting one existing text file. */
export interface FileDeletePlan {
  readonly operation: "delete";
  readonly path: string;
  readonly uri: string;
  readonly beforeContent: string;
  readonly beforeHash: string;
}

/** The immutable host-bound plan prepared for renaming one existing text file. */
export interface FileRenamePlan {
  readonly operation: "rename";
  readonly sourcePath: string;
  readonly targetPath: string;
  readonly sourceUri: string;
  readonly targetUri: string;
  readonly beforeContent: string;
  readonly beforeHash: string;
}

export class InvalidFileDeletePlanError extends Error {
  constructor() {
    super("Invalid file delete plan.");
    this.name = "InvalidFileDeletePlanError";
  }
}

export class InvalidFileRenamePlanError extends Error {
  constructor() {
    super("Invalid file rename plan.");
    this.name = "InvalidFileRenamePlanError";
  }
}

export type FileMutationTextHasher = (text: string) => string;

export function parseFileDeletePlan(
  value: unknown,
  hashText: FileMutationTextHasher,
): FileDeletePlan {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["operation", "path", "uri", "beforeContent", "beforeHash"]) ||
    value.operation !== "delete" ||
    typeof value.path !== "string" ||
    !isSafeMutationPath(value.path) ||
    typeof value.uri !== "string" ||
    !isSafeUri(value.uri) ||
    typeof value.beforeContent !== "string" ||
    !isBoundedMutationText(value.beforeContent) ||
    !checkpointHashSchema.safeParse(value.beforeHash).success
  ) {
    throw new InvalidFileDeletePlanError();
  }

  const path = value.path as string;
  const uri = value.uri as string;
  const beforeContent = value.beforeContent as string;
  const beforeHash = value.beforeHash as string;
  assertHash(beforeContent, beforeHash, hashText, InvalidFileDeletePlanError);

  return { operation: "delete", path, uri, beforeContent, beforeHash };
}

export function parseFileRenamePlan(
  value: unknown,
  hashText: FileMutationTextHasher,
): FileRenamePlan {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "operation",
      "sourcePath",
      "targetPath",
      "sourceUri",
      "targetUri",
      "beforeContent",
      "beforeHash",
    ]) ||
    value.operation !== "rename" ||
    typeof value.sourcePath !== "string" ||
    !isSafeMutationPath(value.sourcePath) ||
    typeof value.targetPath !== "string" ||
    !isSafeMutationPath(value.targetPath) ||
    value.sourcePath === value.targetPath ||
    typeof value.sourceUri !== "string" ||
    !isSafeUri(value.sourceUri) ||
    typeof value.targetUri !== "string" ||
    !isSafeUri(value.targetUri) ||
    value.sourceUri === value.targetUri ||
    typeof value.beforeContent !== "string" ||
    !isBoundedMutationText(value.beforeContent) ||
    !checkpointHashSchema.safeParse(value.beforeHash).success
  ) {
    throw new InvalidFileRenamePlanError();
  }

  const sourcePath = value.sourcePath as string;
  const targetPath = value.targetPath as string;
  const sourceUri = value.sourceUri as string;
  const targetUri = value.targetUri as string;
  const beforeContent = value.beforeContent as string;
  const beforeHash = value.beforeHash as string;
  assertHash(beforeContent, beforeHash, hashText, InvalidFileRenamePlanError);

  return {
    operation: "rename",
    sourcePath,
    targetPath,
    sourceUri,
    targetUri,
    beforeContent,
    beforeHash,
  };
}

function assertHash(
  content: string,
  expected: string,
  hashText: FileMutationTextHasher,
  ErrorType: new () => Error,
): void {
  let actual: string;
  try {
    actual = hashText(content);
  } catch {
    throw new ErrorType();
  }
  if (actual !== expected) {
    throw new ErrorType();
  }
}

function isSafeMutationPath(path: string): boolean {
  return isSafeWorkspacePath(path, {
    maxCharacters: maxFileRenamePathCharacters,
    maxBytes: maxFileRenamePathBytes,
  });
}

function isSafeUri(uri: string): boolean {
  return uri.length > 0 && uri.length <= maxApprovalUriCharacters;
}

function isBoundedMutationText(text: string): boolean {
  return (
    text.isWellFormed() &&
    !text.includes("\0") &&
    [...text].length <= maxFileDeleteContentCharacters &&
    countLogicalLines(text) <= maxFileDeleteContentLines &&
    utf8ByteLength(text) <= maxFileDeleteContentBytes
  );
}

function countLogicalLines(text: string): number {
  return text.length === 0 ? 0 : text.split(/\r\n|\r|\n/u).length;
}
