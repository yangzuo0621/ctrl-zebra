import {
  hasTokenUsage,
  type SessionId,
  type ToolCall,
  tokenUsageSchema,
} from "@ctrl-zebra/protocol";
import { agentSystemInstruction } from "./agent-behavior-policy.js";
import type { AgentRuntimeEvent } from "./agent-runtime.js";
import type { EventSink } from "./events.js";
import type { ModelMessageTokenCounter } from "./history-pruner.js";
import {
  type FinishReason,
  type ModelGateway,
  ModelGatewayError,
  type ModelMessage,
} from "./model-gateway.js";
import type { RunTokenBudgetGuard } from "./run-token-budget.js";
import type { ToolRegistry } from "./tool-registry.js";
import { ToolRepetitionDetectedError, ToolRepetitionDetector } from "./tool-repetition-detector.js";

export class MaxToolStepsExceededError extends Error {
  constructor(readonly maxToolSteps: number) {
    super(`Agent Runtime exceeded the maximum of ${maxToolSteps} Tool Call steps.`);
    this.name = "MaxToolStepsExceededError";
  }
}

export class UnexpectedToolCallError extends Error {
  constructor(readonly toolName: string) {
    super(`The model requested Tool "${toolName}" when tools were unavailable for this request.`);
    this.name = "UnexpectedToolCallError";
  }
}

export class InvalidModelUsageError extends Error {
  constructor() {
    super("ModelGateway emitted invalid token usage.");
    this.name = "InvalidModelUsageError";
  }
}

export type ModelTurnStreamResult =
  | {
      readonly outcome: "response";
      readonly toolCall?: ToolCall;
      readonly hasMeaningfulText: boolean;
    }
  | { readonly outcome: "truncated" }
  | { readonly outcome: "overflow" };

/** Owns one Run's Provider stream projection, reasoning identity, and Tool-call repetition state. */
export class ModelTurnStream {
  readonly #modelGateway: ModelGateway;
  readonly #eventSink: EventSink<AgentRuntimeEvent>;
  readonly #toolRegistry: ToolRegistry;
  readonly #tokenCounter: ModelMessageTokenCounter;
  readonly #budget: RunTokenBudgetGuard;
  readonly #sessionId: SessionId;
  readonly #signal: AbortSignal;
  readonly #offerTools: boolean;
  readonly #maxToolSteps: number;
  readonly #repetitionDetector: ToolRepetitionDetector;
  #nextReasoningBlock = 1;

  constructor(
    modelGateway: ModelGateway,
    eventSink: EventSink<AgentRuntimeEvent>,
    toolRegistry: ToolRegistry,
    tokenCounter: ModelMessageTokenCounter,
    budget: RunTokenBudgetGuard,
    sessionId: SessionId,
    signal: AbortSignal,
    offerTools: boolean,
    maxToolSteps: number,
    toolRepetitionThreshold: number,
  ) {
    this.#modelGateway = modelGateway;
    this.#eventSink = eventSink;
    this.#toolRegistry = toolRegistry;
    this.#tokenCounter = tokenCounter;
    this.#budget = budget;
    this.#sessionId = sessionId;
    this.#signal = signal;
    this.#offerTools = offerTools;
    this.#maxToolSteps = maxToolSteps;
    this.#repetitionDetector = new ToolRepetitionDetector(toolRepetitionThreshold);
  }

  async stream(
    messages: readonly ModelMessage[],
    toolSteps: number,
  ): Promise<ModelTurnStreamResult> {
    let toolCall: ToolCall | undefined;
    let hasMeaningfulText = false;
    let finishReason: FinishReason | undefined;
    let emittedEvent = false;
    const toolDeclarations = this.#offerTools ? this.#toolRegistry.declarations() : [];
    const request =
      toolDeclarations.length === 0
        ? { instructions: agentSystemInstruction, messages: [...messages] }
        : {
            instructions: agentSystemInstruction,
            messages: [...messages],
            tools: toolDeclarations,
          };
    const reasoningBlocks = new Map<string, string>();
    let openReasoningBlock: string | undefined;
    let usageSeen = false;

    try {
      for await (const event of this.#modelGateway.stream(request, this.#signal)) {
        this.#signal.throwIfAborted();
        emittedEvent = true;

        if (event.type === "text.delta") {
          this.#budget.observeEstimate(
            event.text.length === 0
              ? 0
              : this.#tokenCounter.count({ role: "assistant", content: event.text }),
            this.#signal,
          );
          if (event.text.trim() !== "") {
            hasMeaningfulText = true;
          }
          this.#eventSink.emit({
            type: "agent.text-delta",
            sessionId: this.#sessionId,
            text: event.text,
          });
          this.#signal.throwIfAborted();
        } else if (event.type === "reasoning.start") {
          if (openReasoningBlock !== undefined || reasoningBlocks.has(event.blockId)) {
            throw new Error("ModelGateway emitted a malformed reasoning lifecycle.");
          }
          const runtimeBlockId = `reasoning-${this.#nextReasoningBlock}`;
          this.#nextReasoningBlock += 1;
          reasoningBlocks.set(event.blockId, runtimeBlockId);
          openReasoningBlock = event.blockId;
          this.#eventSink.emit({
            type: "agent.reasoning-start",
            sessionId: this.#sessionId,
            blockId: runtimeBlockId,
          });
          this.#signal.throwIfAborted();
        } else if (event.type === "reasoning.delta") {
          const runtimeBlockId = reasoningBlocks.get(event.blockId);
          if (event.blockId !== openReasoningBlock || runtimeBlockId === undefined) {
            throw new Error("ModelGateway emitted a malformed reasoning lifecycle.");
          }
          this.#budget.observeEstimate(
            this.#tokenCounter.count({ role: "assistant", content: event.text }),
            this.#signal,
          );
          this.#eventSink.emit({
            type: "agent.reasoning-delta",
            sessionId: this.#sessionId,
            blockId: runtimeBlockId,
            text: event.text,
          });
          this.#signal.throwIfAborted();
        } else if (event.type === "reasoning.end") {
          const runtimeBlockId = reasoningBlocks.get(event.blockId);
          if (event.blockId !== openReasoningBlock || runtimeBlockId === undefined) {
            throw new Error("ModelGateway emitted a malformed reasoning lifecycle.");
          }
          openReasoningBlock = undefined;
          this.#eventSink.emit({
            type: "agent.reasoning-end",
            sessionId: this.#sessionId,
            blockId: runtimeBlockId,
          });
          this.#signal.throwIfAborted();
        } else if (event.type === "usage") {
          const usageResult = tokenUsageSchema.safeParse(event.usage);
          if (!usageResult.success) {
            throw new InvalidModelUsageError();
          }
          if (!usageSeen && hasTokenUsage(usageResult.data)) {
            usageSeen = true;
            this.#eventSink.emit({
              type: "agent.usage",
              sessionId: this.#sessionId,
              usage: normalizeTokenUsage(usageResult.data),
            });
            this.#signal.throwIfAborted();
            this.#budget.observeUsage(usageResult.data, this.#signal);
          }
        } else if (event.type === "tool.call") {
          if (!this.#offerTools) {
            throw new UnexpectedToolCallError(event.call.name);
          }
          if (toolCall !== undefined) {
            throw new Error("AgentRuntime supports only one Tool Call per model response.");
          }
          if (toolSteps >= this.#maxToolSteps) {
            throw new MaxToolStepsExceededError(this.#maxToolSteps);
          }
          const repetition = this.#repetitionDetector.observe(event.call);
          if (repetition.thresholdReached) {
            throw new ToolRepetitionDetectedError(
              event.call.name,
              repetition.consecutiveCount,
              this.#repetitionDetector.threshold,
            );
          }
          this.#budget.observeEstimate(
            this.#tokenCounter.count({ role: "assistant", toolCall: event.call }),
            this.#signal,
          );
          toolCall = event.call;
          this.#eventSink.emit({
            type: "agent.tool-state",
            sessionId: this.#sessionId,
            call: event.call,
            status: "pending",
          });
          this.#signal.throwIfAborted();
        } else if (event.type === "finish") {
          if (openReasoningBlock !== undefined) {
            throw new Error("ModelGateway completed with an open reasoning block.");
          }
          finishReason = event.reason;
          break;
        }
      }
    } catch (error) {
      this.#signal.throwIfAborted();
      if (
        !emittedEvent &&
        error instanceof ModelGatewayError &&
        error.code === "context-overflow"
      ) {
        return { outcome: "overflow" };
      }
      throw error;
    }

    this.#signal.throwIfAborted();
    if (openReasoningBlock !== undefined) {
      throw new Error("ModelGateway completed with an open reasoning block.");
    }
    if (finishReason === "length") {
      return { outcome: "truncated" };
    }
    return {
      outcome: "response",
      ...(toolCall === undefined ? {} : { toolCall }),
      hasMeaningfulText,
    };
  }
}

function normalizeTokenUsage(
  usage: import("@ctrl-zebra/protocol").TokenUsage,
): import("@ctrl-zebra/protocol").TokenUsage {
  return {
    ...(usage.inputTokens === undefined ? {} : { inputTokens: usage.inputTokens }),
    ...(usage.outputTokens === undefined ? {} : { outputTokens: usage.outputTokens }),
    ...(usage.totalTokens === undefined ? {} : { totalTokens: usage.totalTokens }),
  };
}
