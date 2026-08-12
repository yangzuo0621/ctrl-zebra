import type { AgentTool, ToolExecutionOutput } from "@ctrl-zebra/core";
import { ToolExecutionError } from "@ctrl-zebra/core";
import { type IdeDiagnosticsResultDto, ideDiagnosticsResultSchema } from "@ctrl-zebra/protocol";

import { hasOnlyKeys, isRecord, isSafeForwardSlashPath } from "./boundary-validation.js";

export const getDiagnosticsToolName = "get_diagnostics" as const;
export const getDiagnosticsToolDescription =
  "Read bounded diagnostics for the active file or selected workspace.";
export const getDiagnosticsInputSchema = {
  type: "object",
  properties: {
    scope: {
      type: "string",
      enum: ["active-file", "workspace"],
      description: "Read diagnostics for the active file, one workspace path, or the workspace.",
    },
    path: {
      type: "string",
      description: "Optional workspace-relative path when scope is workspace.",
      minLength: 1,
      maxLength: 4_096,
      pattern: "^(?!/)(?!.*\\\\)(?!.*(?:^|/)\\.{1,2}(?:/|$)).+$",
    },
  },
  required: ["scope"],
  additionalProperties: false,
} as const;

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
  if (!isRecord(value)) {
    throw new TypeError("Expected get_diagnostics input to be an object.");
  }
  if (!hasOnlyKeys(value, new Set(["scope", "path"]))) {
    throw new TypeError("Unexpected get_diagnostics input field.");
  }

  if (value.scope !== "active-file" && value.scope !== "workspace") {
    throw new TypeError("Invalid get_diagnostics scope.");
  }

  if (value.scope === "active-file") {
    if (Object.hasOwn(value, "path")) {
      throw new TypeError("get_diagnostics active-file does not accept a path.");
    }
    return { scope: "active-file" };
  }

  if (!Object.hasOwn(value, "path")) {
    return { scope: "workspace" };
  }
  if (
    !isSafeForwardSlashPath(value.path, {
      maxLength: 4_096,
      allowLeadingSlash: false,
      rejectCurrentSegments: true,
    })
  ) {
    throw new TypeError("Invalid get_diagnostics workspace path.");
  }
  return { scope: "workspace", path: value.path };
}
