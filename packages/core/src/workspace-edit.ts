import {
  type ApprovalResourceRevision,
  approvalResourceRevisionSchema,
  maxApprovalUriCharacters,
} from "@ctrl-zebra/protocol";

import { hasExactKeys, isRecord } from "./record-validation.js";
import {
  InvalidTextEditPlanError,
  OverlappingTextEditsError,
  parseTextEdits,
  type TextEdit,
} from "./text-edit.js";
import { utf8ByteLength } from "./text-primitives.js";

export const minWorkspaceEditFiles = 2;
export const maxWorkspaceEditFiles = 128;
export const maxWorkspaceEditPathCharacters = 4_096;
export const maxWorkspaceEditPathBytes = 16_384;
export const maxWorkspaceEditReplacementCharacters = 65_536;
export const maxWorkspaceEditReplacementBytes = 262_144;
export const maxWorkspaceEditAggregateReplacementBytes = 1_048_576;

/** One immutable, host-bound target in a multi-file edit plan. */
export interface WorkspaceEditFilePlan {
  readonly path: string;
  readonly uri: string;
  readonly originalRevision: ApprovalResourceRevision;
  readonly edits: readonly TextEdit[];
}

/** An edit-only plan covering at least two existing workspace files. */
export interface WorkspaceEditPlan {
  readonly operation: "edit";
  readonly files: readonly WorkspaceEditFilePlan[];
}

export class InvalidWorkspaceEditPlanError extends Error {
  constructor() {
    super("Invalid workspace edit plan.");
    this.name = "InvalidWorkspaceEditPlanError";
  }
}

export class OverlappingWorkspaceEditError extends Error {
  constructor() {
    super("Workspace edit ranges must not overlap or share a start position.");
    this.name = "OverlappingWorkspaceEditError";
  }
}

export function parseWorkspaceEditPlan(value: unknown): WorkspaceEditPlan {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["operation", "files"]) ||
    value.operation !== "edit" ||
    !Array.isArray(value.files) ||
    value.files.length < minWorkspaceEditFiles ||
    value.files.length > maxWorkspaceEditFiles
  ) {
    throw new InvalidWorkspaceEditPlanError();
  }

  const files = value.files.map(parseWorkspaceEditFile).sort(compareWorkspaceEditFiles);
  const paths = new Set<string>();
  const uris = new Set<string>();
  let aggregateReplacementBytes = 0;
  for (const file of files) {
    if (paths.has(file.path) || uris.has(file.uri)) {
      throw new InvalidWorkspaceEditPlanError();
    }
    paths.add(file.path);
    uris.add(file.uri);
    for (const edit of file.edits) {
      aggregateReplacementBytes += utf8ByteLength(edit.newText);
      if (aggregateReplacementBytes > maxWorkspaceEditAggregateReplacementBytes) {
        throw new InvalidWorkspaceEditPlanError();
      }
    }
  }

  return { operation: "edit", files };
}

function parseWorkspaceEditFile(value: unknown): WorkspaceEditFilePlan {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["path", "uri", "originalRevision", "edits"]) ||
    typeof value.path !== "string" ||
    !isSafeWorkspaceEditPath(value.path) ||
    typeof value.uri !== "string" ||
    value.uri.length === 0 ||
    value.uri.length > maxApprovalUriCharacters ||
    !Array.isArray(value.edits)
  ) {
    throw new InvalidWorkspaceEditPlanError();
  }

  const revision = approvalResourceRevisionSchema.safeParse(value.originalRevision);
  if (!revision.success) {
    throw new InvalidWorkspaceEditPlanError();
  }

  let edits: readonly TextEdit[];
  try {
    edits = parseTextEdits(value.edits);
  } catch (error) {
    if (error instanceof OverlappingTextEditsError) {
      throw new OverlappingWorkspaceEditError();
    }
    if (error instanceof InvalidTextEditPlanError) {
      throw new InvalidWorkspaceEditPlanError();
    }
    throw error;
  }
  for (const edit of edits) {
    if (!isBoundedWorkspaceEditReplacement(edit.newText)) {
      throw new InvalidWorkspaceEditPlanError();
    }
  }

  return {
    path: value.path,
    uri: value.uri,
    originalRevision: revision.data,
    edits,
  };
}

function isSafeWorkspaceEditPath(path: string): boolean {
  if (
    path.length === 0 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    [...path].length > maxWorkspaceEditPathCharacters ||
    utf8ByteLength(path) > maxWorkspaceEditPathBytes
  ) {
    return false;
  }

  return path
    .split("/")
    .every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function isBoundedWorkspaceEditReplacement(text: string): boolean {
  return (
    text.isWellFormed() &&
    !text.includes("\0") &&
    [...text].length <= maxWorkspaceEditReplacementCharacters &&
    utf8ByteLength(text) <= maxWorkspaceEditReplacementBytes
  );
}

function compareWorkspaceEditFiles(
  left: WorkspaceEditFilePlan,
  right: WorkspaceEditFilePlan,
): number {
  return compareStrings(left.path, right.path) || compareStrings(left.uri, right.uri);
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
