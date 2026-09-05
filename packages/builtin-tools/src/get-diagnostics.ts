import type { AgentTool, ToolExecutionOutput } from "@ctrl-zebra/core";
import { ToolExecutionError } from "@ctrl-zebra/core";
import { type IdeDiagnosticsResultDto, ideDiagnosticsResultSchema } from "@ctrl-zebra/protocol";
import { z } from "zod";

import { workspaceRelativePathSchema } from "./workspace-path-schema.js";
import { toToolInputSchema } from "./zod-tool-schema.js";

export const getDiagnosticsToolName = "get_diagnostics" as const;
export const getDiagnosticsToolDescription =
  "Read bounded diagnostics for the active file or selected workspace.";

const getDiagnosticsZodSchema = z
  .strictObject({
    scope: z
      .enum(["active-file", "workspace"])
      .describe("Read diagnostics for the active file, one workspace path, or the workspace."),
    path: workspaceRelativePathSchema(
      "Optional workspace-relative path when scope is workspace.",
    ).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.scope === "active-file" && value.path !== undefined) {
      ctx.addIssue({
        code: "custom",
        message: "get_diagnostics active-file does not accept a path.",
        path: ["path"],
      });
    }
  });
export const getDiagnosticsInputSchema = toToolInputSchema(getDiagnosticsZodSchema);

export type GetDiagnosticsScope = "active-file" | "workspace";

export interface GetDiagnosticsInput {
  readonly scope: GetDiagnosticsScope;
  readonly path?: string;
}

export interface IdeDiagnosticsPort {
  getDiagnostics(input: GetDiagnosticsInput, signal: AbortSignal): Promise<unknown>;
}

export class DiagnosticsUnavailableError extends Error {
  constructor() {
    super("Diagnostics are unavailable.");
    this.name = "DiagnosticsUnavailableError";
  }
}

/** The host supplied a diagnostics value that cannot be projected safely. */
export class InvalidDiagnosticsOutputError extends Error {
  constructor() {
    super("Diagnostics returned invalid output.");
    this.name = "InvalidDiagnosticsOutputError";
  }
}

export function createGetDiagnosticsTool(
  port: IdeDiagnosticsPort,
): AgentTool<GetDiagnosticsInput, IdeDiagnosticsResultDto> {
  return {
    name: getDiagnosticsToolName,
    description: getDiagnosticsToolDescription,
    inputSchema: getDiagnosticsInputSchema,
    risk: "read",
    parseInput: parseGetDiagnosticsInput,
    async execute(input, { signal }): Promise<ToolExecutionOutput<IdeDiagnosticsResultDto>> {
      signal.throwIfAborted();

      let value: unknown;
      try {
        value = await port.getDiagnostics(input, signal);
      } catch (error) {
        signal.throwIfAborted();
        if (error instanceof DiagnosticsUnavailableError) {
          throw new ToolExecutionError("failed", error.message);
        }
        if (error instanceof InvalidDiagnosticsOutputError) {
          throw new ToolExecutionError("invalid-output", error.message);
        }
        throw error;
      }

      signal.throwIfAborted();
      const result = ideDiagnosticsResultSchema.safeParse(value);
      if (!result.success) {
        throw new ToolExecutionError("invalid-output", "Diagnostics returned invalid output.");
      }

      return { output: result.data, truncated: result.data.truncated };
    },
  };
}

export function parseGetDiagnosticsInput(value: unknown): GetDiagnosticsInput {
  const parsed = getDiagnosticsZodSchema.parse(value);
  return parsed.path === undefined
    ? { scope: parsed.scope }
    : { scope: parsed.scope, path: parsed.path };
}
