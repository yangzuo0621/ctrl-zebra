import type { ToolName } from "@ctrl-zebra/protocol";
import type { AgentTool } from "./tool-registry.js";

export class InvalidToolInputError extends Error {
  readonly code = "invalid-input" as const;

  constructor(readonly toolName: ToolName) {
    super(`Invalid input for tool "${toolName}".`);
    this.name = "InvalidToolInputError";
  }
}

export function parseToolInput<Input>(
  tool: Pick<AgentTool<Input>, "name" | "parseInput">,
  value: unknown,
): Input {
  try {
    return tool.parseInput(value);
  } catch {
    throw new InvalidToolInputError(tool.name);
  }
}
