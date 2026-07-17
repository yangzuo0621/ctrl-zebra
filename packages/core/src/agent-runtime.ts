import {
  type SessionId,
  type SessionStatus,
  type ToolCall,
  type ToolErrorCode,
  type ToolErrorResult,
  type ToolResult,
  type ToolSuccessResult,
  toolResultSchema,
  type UserMessage,
} from "@ctrl-zebra/protocol";

import type { DomainEvent, EventSink } from "./events.js";
import type { ModelGateway, ModelMessage } from "./model-gateway.js";
import { SessionStateMachine, type SessionStatusChangedEvent } from "./session-state-machine.js";
import { InvalidToolInputError, parseToolInput } from "./tool-input-validation.js";
import { type ToolExecutionOutput, ToolRegistry } from "./tool-registry.js";

export interface AgentTextDeltaEvent extends DomainEvent {
  readonly type: "agent.text-delta";
  readonly sessionId: SessionId;
  readonly text: string;
}

interface AgentToolStateEventBase extends DomainEvent {
  readonly type: "agent.tool-state";
  readonly sessionId: SessionId;
  readonly call: ToolCall;
}

export type AgentToolStateEvent =
  | (AgentToolStateEventBase & { readonly status: "pending" | "running" })
  | (AgentToolStateEventBase & {
      readonly status: "success";
      readonly result: ToolSuccessResult;
    })
  | (AgentToolStateEventBase & {
      readonly status: "error";
      readonly result: ToolErrorResult;
    });

export type AgentRuntimeEvent =
  | AgentTextDeltaEvent
  | AgentToolStateEvent
  | SessionStatusChangedEvent;

export const defaultMaxToolSteps = 8;

export interface AgentRuntimeOptions {
  readonly maxToolSteps?: number;
}

export class MaxToolStepsExceededError extends Error {
  constructor(readonly maxToolSteps: number) {
    super(`Agent Runtime exceeded the maximum of ${maxToolSteps} Tool Call steps.`);
    this.name = "MaxToolStepsExceededError";
  }
}

export class AgentRuntime {
  readonly #modelGateway: ModelGateway;
  readonly #eventSink: EventSink<AgentRuntimeEvent>;
  readonly #toolRegistry: ToolRegistry;
  readonly #maxToolSteps: number;

  constructor(
    modelGateway: ModelGateway,
    eventSink: EventSink<AgentRuntimeEvent>,
    toolRegistry: ToolRegistry = new ToolRegistry(),
    options: AgentRuntimeOptions = {},
  ) {
    const maxToolSteps = options.maxToolSteps ?? defaultMaxToolSteps;
    if (!Number.isSafeInteger(maxToolSteps) || maxToolSteps < 1) {
      throw new RangeError("maxToolSteps must be a positive safe integer.");
    }

    this.#modelGateway = modelGateway;
    this.#eventSink = eventSink;
    this.#toolRegistry = toolRegistry;
    this.#maxToolSteps = maxToolSteps;
  }

  async run(userMessage: UserMessage, signal: AbortSignal): Promise<void> {
    const session = new SessionStateMachine(userMessage.sessionId, "idle", this.#eventSink);

    try {
      session.transitionTo("preparing");
      signal.throwIfAborted();
      const messages: ModelMessage[] = [{ role: "user", content: userMessage.content }];
      session.transitionTo("streaming");
      let toolSteps = 0;

      while (true) {
        const toolCall = await this.#streamModel(messages, userMessage.sessionId, signal);
        if (toolCall === undefined) {
          break;
        }

        if (toolSteps >= this.#maxToolSteps) {
          throw new MaxToolStepsExceededError(this.#maxToolSteps);
        }

        this.#emitToolState(userMessage.sessionId, toolCall, "pending");
        session.transitionTo("executing_tool");
        this.#emitToolState(userMessage.sessionId, toolCall, "running");
        const toolResult = await this.#executeTool(toolCall, signal);
        this.#emitToolResult(userMessage.sessionId, toolCall, toolResult);
        messages.push({ role: "assistant", toolCall }, { role: "tool", result: toolResult });
        toolSteps += 1;
        signal.throwIfAborted();
        session.transitionTo("streaming");
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
    let execution: ToolExecutionOutput<unknown>;
    try {
      execution = await tool.execute(input, { signal });
    } catch {
      signal.throwIfAborted();
      return createToolErrorResult(
        toolCall,
        "failed",
        `Tool "${toolCall.name}" failed during execution.`,
      );
    }

    signal.throwIfAborted();
    const result = toolResultSchema.safeParse({
      callId: toolCall.id,
      name: toolCall.name,
      status: "success",
      output: execution.output,
      truncated: execution.truncated,
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

  #emitToolState(sessionId: SessionId, call: ToolCall, status: "pending" | "running"): void {
    this.#eventSink.emit({ type: "agent.tool-state", sessionId, call, status });
  }

  #emitToolResult(sessionId: SessionId, call: ToolCall, result: ToolResult): void {
    if (result.status === "success") {
      this.#eventSink.emit({
        type: "agent.tool-state",
        sessionId,
        call,
        status: "success",
        result,
      });
      return;
    }

    this.#eventSink.emit({
      type: "agent.tool-state",
      sessionId,
      call,
      status: "error",
      result,
    });
  }
}

function createToolErrorResult(
  toolCall: ToolCall,
  code: ToolErrorCode,
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
