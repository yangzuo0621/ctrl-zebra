import type { ToolErrorCode, ToolName, ToolRisk } from "@ctrl-zebra/protocol";

import type { AgentToolInputSchema, ToolDeclaration } from "./model-gateway.js";

export interface ToolExecutionContext {
  readonly signal: AbortSignal;
}

export interface ToolExecutionOutput<Output> {
  readonly output: Output;
  readonly truncated: boolean;
}

export interface AgentTool<Input = unknown, Output = unknown> {
  readonly name: ToolName;
  readonly description: string;
  readonly inputSchema: AgentToolInputSchema;
  readonly risk: ToolRisk;
  parseInput(value: unknown): Input;
  execute(input: Input, context: ToolExecutionContext): Promise<ToolExecutionOutput<Output>>;
  prepareApproval?(
    input: Input,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionOutput<unknown>>;
}

export class ToolUnavailableError extends Error {
  constructor() {
    super("The Tool is no longer available.");
    this.name = "ToolUnavailableError";
  }
}

export class ToolExecutionError extends Error {
  constructor(
    readonly code: Extract<ToolErrorCode, "failed" | "invalid-output">,
    message: string,
  ) {
    super(message);
    this.name = "ToolExecutionError";
  }
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

  declarations(): readonly ToolDeclaration[] {
    return [...this.#tools.values()]
      .sort((left, right) => left.name.localeCompare(right.name, "en-US"))
      .map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
  }
}
