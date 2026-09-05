import {
  type AgentTool,
  type FileCreatePlan,
  maxApprovalUriCharacters,
  maxFileCreateContentBytes,
  maxFileCreateContentCharacters,
  maxFileCreateContentLines,
  maxFileCreatePathBytes,
  parseFileCreatePlan,
  type ToolExecutionOutput,
} from "@ctrl-zebra/core";
import { checkpointHashSchema } from "@ctrl-zebra/protocol";
import { z } from "zod";
import { hasOnlyKeys, isRecord } from "./boundary-validation.js";
import { boundedWorkspaceTextSchema } from "./bounded-text-schema.js";
import {
  isSafeWorkspaceRelativePath,
  workspaceRelativePathSchema,
} from "./workspace-path-schema.js";
import { toToolInputSchema } from "./zod-tool-schema.js";

export const proposeFileCreateToolName = "propose_file_create" as const;
export const proposeFileCreateToolDescription =
  "Propose a bounded UTF-8 text file in the selected workspace; creation applies only after explicit user approval.";

export const maxProposedFileCreateCharacters = maxFileCreateContentCharacters;
export const maxProposedFileCreateLines = maxFileCreateContentLines;
export const maxProposedFileCreateBytes = maxFileCreateContentBytes;
export const maxProposedFileCreatePathBytes = maxFileCreatePathBytes;

const proposeFileCreateContentBounds = {
  maxCharacters: maxProposedFileCreateCharacters,
  maxLines: maxProposedFileCreateLines,
  maxBytes: maxProposedFileCreateBytes,
};

const proposeFileCreateZodSchema = z.strictObject({
  path: workspaceRelativePathSchema(
    "Workspace-relative file path using forward slashes.",
    4_096,
    maxProposedFileCreatePathBytes,
  ),
  content: boundedWorkspaceTextSchema(
    "Complete UTF-8 text content for the new file.",
    proposeFileCreateContentBounds,
  ),
});

// `boundedWorkspaceTextSchema`'s bound is enforced through `.refine()`, not `.max()` (see its
// docs), so `toToolInputSchema()` cannot derive a `maxLength` for `content` on its own; splice the
// same `maxLength` this tool has always advertised back in, to keep the model-facing schema byte-
// for-byte the schema it replaces.
const generatedProposeFileCreateInputSchema = toToolInputSchema(proposeFileCreateZodSchema);
export const proposeFileCreateInputSchema = {
  ...generatedProposeFileCreateInputSchema,
  properties: {
    ...generatedProposeFileCreateInputSchema.properties,
    content: {
      type: "string",
      description: "Complete UTF-8 text content for the new file.",
      maxLength: maxProposedFileCreateCharacters,
    },
  },
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
  readonly hashText: (text: string) => string;
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
      output: parseFileCreatePlan(
        {
          operation: "create",
          path: snapshot.path,
          uri: snapshot.uri,
          content: input.content,
          afterHash: snapshot.afterHash,
        },
        workspace.hashText,
      ),
      truncated: false,
    };
  };
}

function parseProposeFileCreateInput(value: unknown): ProposeFileCreateInput {
  return proposeFileCreateZodSchema.parse(value);
}

function parseFileCreateTargetSnapshot(value: unknown): FileCreateTargetSnapshot {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, new Set(["path", "uri", "afterHash"])) ||
    !isSafeWorkspaceRelativePath(value.path, maxProposedFileCreatePathBytes) ||
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
