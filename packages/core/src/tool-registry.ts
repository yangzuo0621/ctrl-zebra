import type { ToolName, ToolRisk } from "@ctrl-zebra/protocol";

export interface ToolExecutionContext {
  readonly signal: AbortSignal;
}

export interface ToolExecutionOutput<Output> {
  readonly output: Output;
  readonly truncated: boolean;
}

export interface AgentTool<Input = unknown, Output = unknown> {
  readonly name: ToolName;
  readonly risk: ToolRisk;
  parseInput(value: unknown): Input;
  execute(input: Input, context: ToolExecutionContext): Promise<ToolExecutionOutput<Output>>;
}

export class DuplicateToolRegistrationError extends Error {
  constructor(readonly toolName: ToolName) {
    super(`A tool named "${toolName}" is already registered.`);
    this.name = "DuplicateToolRegistrationError";
  }
}

export class ToolRegistry {
  readonly #tools = new Map<ToolName, AgentTool>();

  register<Input, Output>(tool: AgentTool<Input, Output>): void {
    if (this.#tools.has(tool.name)) {
      throw new DuplicateToolRegistrationError(tool.name);
    }

    this.#tools.set(tool.name, tool);
  }

  get(name: ToolName): AgentTool | undefined {
    return this.#tools.get(name);
  }
}
