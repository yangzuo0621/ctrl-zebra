import type { AgentTool, ToolExecutionOutput } from "@ctrl-zebra/core";
import { z } from "zod";

import { parseWorkspaceFilePaths } from "./boundary-validation.js";
import { toToolInputSchema } from "./zod-tool-schema.js";

export const listFilesToolName = "list_files" as const;
export const listFilesToolDescription =
  "List files in the selected workspace that match a glob pattern.";

export const defaultListFilesLimit = 100;
export const maxListFilesLimit = 200;
export const listFilesExcludeGlob = "**/{.git,node_modules,dist,build,coverage,.next,out}/**";

/**
 * Allows a leading slash and "." segments (glob syntax uses both), unlike
 * workspace-path-schema.ts's stricter workspace-relative-path pattern -- only a ".." segment or a
 * backslash is rejected. Also used verbatim by search-files.ts; kept local here rather than
 * extracted into a shared module until that tool's own tranche touches it.
 */
const listFilesGlobPattern = /^(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\\).+$/u;

const listFilesInputZodSchema = z.strictObject({
  glob: z
    .string()
    .min(1)
    .max(256)
    .regex(listFilesGlobPattern)
    .describe("Workspace-relative glob pattern. Defaults to **/*.")
    .optional(),
  maxResults: z
    .number()
    .int()
    .min(1)
    .max(maxListFilesLimit)
    .describe("Maximum number of files to return. Defaults to 100.")
    .optional(),
});
export const listFilesInputSchema = toToolInputSchema(listFilesInputZodSchema);

export interface ListFilesInput {
  readonly glob: string;
  readonly maxResults: number;
}

export interface ListFilesOutput {
  readonly files: readonly string[];
}

export interface ListFilesRequest {
  readonly glob: string;
  readonly excludeGlob: string;
  readonly maxResults: number;
}

export interface ListFilesWorkspace {
  findFiles(request: ListFilesRequest, signal: AbortSignal): Promise<unknown>;
}

export class InvalidWorkspaceFileListError extends Error {
  constructor() {
    super("Workspace file listing returned invalid paths.");
    this.name = "InvalidWorkspaceFileListError";
  }
}

export function createListFilesTool(
  workspace: ListFilesWorkspace,
): AgentTool<ListFilesInput, ListFilesOutput> {
  return {
    name: listFilesToolName,
    description: listFilesToolDescription,
    inputSchema: listFilesInputSchema,
    risk: "read",
    parseInput: parseListFilesInput,
    async execute(input, { signal }): Promise<ToolExecutionOutput<ListFilesOutput>> {
      signal.throwIfAborted();
      const value = await workspace.findFiles(
        {
          glob: input.glob,
          excludeGlob: listFilesExcludeGlob,
          maxResults: input.maxResults + 1,
        },
        signal,
      );
      signal.throwIfAborted();
      const files = parseWorkspaceFileList(value);
      const truncated = files.length > input.maxResults;

      return {
        output: { files: files.slice(0, input.maxResults) },
        truncated,
      };
    },
  };
}

function parseListFilesInput(value: unknown): ListFilesInput {
  const parsed = listFilesInputZodSchema.parse(value);
  return {
    glob: parsed.glob ?? "**/*",
    maxResults: parsed.maxResults ?? defaultListFilesLimit,
  };
}

function parseWorkspaceFileList(value: unknown): readonly string[] {
  return parseWorkspaceFilePaths(value, () => new InvalidWorkspaceFileListError());
}
