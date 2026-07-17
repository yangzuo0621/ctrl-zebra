import {
  type SessionId,
  type SessionStatus,
  type ToolCall,
  type ToolResult,
  toolResultSchema,
  type UserMessage,
} from "@ctrl-zebra/protocol";

import type { DomainEvent, EventSink } from "./events.js";
import type { ModelGateway, ModelMessage } from "./model-gateway.js";
import { SessionStateMachine, type SessionStatusChangedEvent } from "./session-state-machine.js";
import { InvalidToolInputError, parseToolInput } from "./tool-input-validation.js";
import { ToolRegistry } from "./tool-registry.js";

export interface AgentTextDeltaEvent extends DomainEvent {
  readonly type: "agent.text-delta";
  readonly sessionId: SessionId;
  readonly text: string;
}

export type AgentRuntimeEvent = AgentTextDeltaEvent | SessionStatusChangedEvent;

export class AgentRuntime {
  readonly #modelGateway: ModelGateway;
  readonly #eventSink: EventSink<AgentRuntimeEvent>;
  readonly #toolRegistry: ToolRegistry;

  constructor(
    modelGateway: ModelGateway,
    eventSink: EventSink<AgentRuntimeEvent>,
    toolRegistry: ToolRegistry = new ToolRegistry(),
  ) {
    this.#modelGateway = modelGateway;
    this.#eventSink = eventSink;
    this.#toolRegistry = toolRegistry;
  }

  async run(userMessage: UserMessage, signal: AbortSignal): Promise<void> {
    const session = new SessionStateMachine(userMessage.sessionId, "idle", this.#eventSink);

    try {
      session.transitionTo("preparing");
      signal.throwIfAborted();
      const messages: ModelMessage[] = [{ role: "user", content: userMessage.content }];
      session.transitionTo("streaming");
      const toolCall = await this.#streamModel(messages, userMessage.sessionId, signal);

      if (toolCall !== undefined) {
        session.transitionTo("executing_tool");
        const toolResult = await this.#executeTool(toolCall, signal);
        messages.push({ role: "assistant", toolCall }, { role: "tool", result: toolResult });
        signal.throwIfAborted();
        session.transitionTo("streaming");

        const additionalToolCall = await this.#streamModel(messages, userMessage.sessionId, signal);
        if (additionalToolCall !== undefined) {
          throw new Error("AgentRuntime supports only one Tool Call per run.");
        }
      }

      signal.throwIfAborted();
      session.transitionTo("completed");
    } catch (error) {
      if (isCancellation(error, signal)) {
        if (isActiveStatus(session.status)) {
          session.transitionTo("cancelled");
        }
        return;
      }

      if (isActiveStatus(session.status)) {
        session.transitionTo("failed");
      }
      throw error;
    }
  }

  async #streamModel(
    messages: readonly ModelMessage[],
    sessionId: SessionId,
    signal: AbortSignal,
  ): Promise<ToolCall | undefined> {
    let toolCall: ToolCall | undefined;

    for await (const event of this.#modelGateway.stream({ messages: [...messages] }, signal)) {
      signal.throwIfAborted();

      if (event.type === "text.delta") {
        this.#eventSink.emit({
          type: "agent.text-delta",
          sessionId,
          text: event.text,
        });
      } else if (event.type === "tool.call") {
        if (toolCall !== undefined) {
          throw new Error("AgentRuntime supports only one Tool Call per model response.");
        }

        toolCall = event.call;
      }
    }

    signal.throwIfAborted();
    return toolCall;
  }

  async #executeTool(toolCall: ToolCall, signal: AbortSignal): Promise<ToolResult> {
    const tool = this.#toolRegistry.get(toolCall.name);
    if (tool === undefined) {
      return createToolErrorResult(toolCall, "unknown-tool", `Unknown tool: ${toolCall.name}.`);
    }

    let input: unknown;
    try {
      input = parseToolInput(tool, toolCall.input);
    } catch (error) {
      if (error instanceof InvalidToolInputError) {
        return createToolErrorResult(toolCall, error.code, error.message);
      }

      throw error;
    }

    signal.throwIfAborted();
    const output = await tool.execute(input, { signal });
    signal.throwIfAborted();
    const result = toolResultSchema.safeParse({
      callId: toolCall.id,
      name: toolCall.name,
      status: "success",
      output,
      truncated: false,
    });

    if (!result.success) {
      return createToolErrorResult(
        toolCall,
        "invalid-output",
        `Tool "${toolCall.name}" returned invalid output.`,
      );
    }

    return result.data;
  }
}

function createToolErrorResult(
  toolCall: ToolCall,
  code: "invalid-input" | "unknown-tool" | "invalid-output",
  message: string,
): ToolResult {
  return {
    callId: toolCall.id,
    name: toolCall.name,
    status: "error",
    error: { code, message },
  };
}

function isCancellation(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted && error === signal.reason;
}

function isActiveStatus(status: SessionStatus): boolean {
  return status === "preparing" || status === "streaming" || status === "executing_tool";
}
