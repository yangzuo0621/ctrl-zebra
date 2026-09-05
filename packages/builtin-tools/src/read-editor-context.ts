import type { AgentTool, ToolExecutionOutput } from "@ctrl-zebra/core";
import { ToolExecutionError } from "@ctrl-zebra/core";
import { type IdeTextContextDto, ideTextContextSchema } from "@ctrl-zebra/protocol";
import { z } from "zod";

import { toToolInputSchema } from "./zod-tool-schema.js";

export const readEditorContextToolName = "read_editor_context" as const;
export const readEditorContextToolDescription =
  "Read the explicitly selected active editor or text selection in the selected workspace.";

const readEditorContextZodSchema = z.strictObject({
  scope: z
    .enum(["active-editor", "selection"])
    .describe("Read the active document or its exact current selection."),
});
export const readEditorContextInputSchema = toToolInputSchema(readEditorContextZodSchema);

export type ReadEditorContextScope = "active-editor" | "selection";

export interface ReadEditorContextInput {
  readonly scope: ReadEditorContextScope;
}

export interface IdeContextPort {
  readEditorContext(input: ReadEditorContextInput, signal: AbortSignal): Promise<unknown>;
}

export type ReadEditorContextPort = IdeContextPort;

export class EditorContextUnavailableError extends Error {
  constructor() {
    super("Editor context is unavailable.");
    this.name = "EditorContextUnavailableError";
  }
}

export function createReadEditorContextTool(
  port: ReadEditorContextPort,
): AgentTool<
  ReadEditorContextInput,
  { readonly kind: "editor-context"; readonly context: IdeTextContextDto }
> {
  return {
    name: readEditorContextToolName,
    description: readEditorContextToolDescription,
    inputSchema: readEditorContextInputSchema,
    risk: "read",
    parseInput: parseReadEditorContextInput,
    async execute(
      input,
      { signal },
    ): Promise<
      ToolExecutionOutput<{ readonly kind: "editor-context"; readonly context: IdeTextContextDto }>
    > {
      signal.throwIfAborted();

      let value: unknown;
      try {
        value = await port.readEditorContext(input, signal);
      } catch (error) {
        signal.throwIfAborted();
        if (error instanceof EditorContextUnavailableError) {
          throw new ToolExecutionError("failed", error.message);
        }
        throw error;
      }

      signal.throwIfAborted();
      const context = ideTextContextSchema.safeParse(value);
      if (!context.success) {
        throw new ToolExecutionError("invalid-output", "Editor context returned invalid output.");
      }

      return {
        output: { kind: "editor-context", context: context.data },
        truncated: context.data.source.truncated,
      };
    },
  };
}

function parseReadEditorContextInput(value: unknown): ReadEditorContextInput {
  return readEditorContextZodSchema.parse(value);
}
