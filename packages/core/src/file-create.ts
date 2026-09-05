import {
  checkpointHashSchema,
  maxApprovalUriCharacters,
  utf8ByteLength,
} from "@ctrl-zebra/protocol";

import { hasExactKeys, isRecord } from "./record-validation.js";
import {
  isSafeWorkspacePath,
  maxWorkspacePathBytes,
  maxWorkspacePathCharacters,
} from "./workspace-path.js";

export const maxFileCreatePathCharacters = maxWorkspacePathCharacters;
export const maxFileCreatePathBytes = maxWorkspacePathBytes;
export const maxFileCreateContentCharacters = 65_536;
export const maxFileCreateContentLines = 2_000;
export const maxFileCreateContentBytes = 262_144;

/** The immutable host-bound plan prepared for a proposed new text file. */
export interface FileCreatePlan {
  readonly operation: "create";
  readonly path: string;
  readonly uri: string;
  readonly content: string;
  readonly afterHash: string;
}

export class InvalidFileCreatePlanError extends Error {
  constructor() {
    super("Invalid file create plan.");
    this.name = "InvalidFileCreatePlanError";
  }
}

export type FileCreateTextHasher = (text: string) => string;

export function parseFileCreatePlan(
  value: unknown,
  hashText: FileCreateTextHasher,
): FileCreatePlan {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["operation", "path", "uri", "content", "afterHash"]) ||
    value.operation !== "create" ||
    typeof value.path !== "string" ||
    !isSafeFileCreatePath(value.path) ||
    typeof value.uri !== "string" ||
    value.uri.length === 0 ||
    value.uri.length > maxApprovalUriCharacters ||
    typeof value.content !== "string" ||
    !isBoundedFileCreateContent(value.content) ||
    !checkpointHashSchema.safeParse(value.afterHash).success
  ) {
    throw new InvalidFileCreatePlanError();
  }

  const path = value.path as string;
  const uri = value.uri as string;
  const content = value.content as string;
  const afterHash = value.afterHash as string;
  let actualHash: string;
  try {
    actualHash = hashText(content);
  } catch {
    throw new InvalidFileCreatePlanError();
  }
  if (actualHash !== afterHash) {
    throw new InvalidFileCreatePlanError();
  }

  return {
    operation: "create",
    path,
    uri,
    content,
    afterHash,
  };
}

function isSafeFileCreatePath(path: string): boolean {
  return isSafeWorkspacePath(path, {
    maxCharacters: maxFileCreatePathCharacters,
    maxBytes: maxFileCreatePathBytes,
  });
}

function isBoundedFileCreateContent(content: string): boolean {
  return (
    content.isWellFormed() &&
    !content.includes("\0") &&
    [...content].length <= maxFileCreateContentCharacters &&
    countLogicalLines(content) <= maxFileCreateContentLines &&
    utf8ByteLength(content) <= maxFileCreateContentBytes
  );
}

function countLogicalLines(content: string): number {
  return content.length === 0 ? 0 : content.split(/\r\n|\r|\n/u).length;
}
