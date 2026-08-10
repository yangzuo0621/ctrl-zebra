import {
  type ApprovalRequest,
  type ApprovalStatus,
  approvalRequestSchema,
  type CheckpointRunId,
  type JsonValue,
  jsonValueSchema,
  type McpPromptConfirmation,
  type McpResourceAttachment,
  type SessionId,
  type SessionStatus,
  hasTokenUsage,
  type ToolCall,
  type ToolErrorCode,
  type ToolErrorResult,
  type ToolResult,
  type ToolSuccessResult,
  tokenUsageSchema,
  toolCallSchema,
  toolResultSchema,
  type UserMessage,
} from "@ctrl-zebra/protocol";
import { agentSystemInstruction, shouldOfferWorkspaceTools } from "./agent-behavior-policy.js";
import { BasicApprovalPolicy } from "./approval-policy.js";
import type { DomainEvent, EventSink } from "./events.js";
import { projectExternalMcpContext } from "./external-resource-context.js";
import { defaultModelMessageTokenCounter } from "./heuristic-token-counter.js";
import {
  InvalidModelHistoryError,
  type ModelMessageTokenCounter,
  pruneModelHistory,
} from "./history-pruner.js";
import type { ModelGateway, ModelMessage } from "./model-gateway.js";
import { SessionStateMachine, type SessionStatusChangedEvent } from "./session-state-machine.js";
import { allocateTokenBudget, maxModelContextWindowTokens } from "./token-budget.js";
import type { ToolApprovalOperation, ToolApprovalWorkflow } from "./tool-approval.js";
import { InvalidToolInputError, parseToolInput } from "./tool-input-validation.js";
import { limitToolOutput } from "./tool-output-limiter.js";
import {
  ToolExecutionError,
  type ToolExecutionOutput,
  ToolRegistry,
  ToolUnavailableError,
} from "./tool-registry.js";
import {
  defaultToolRepetitionThreshold,
  ToolRepetitionDetectedError,
  ToolRepetitionDetector,
} from "./tool-repetition-detector.js";

export interface AgentTextDeltaEvent extends DomainEvent {
  readonly type: "agent.text-delta";
  readonly sessionId: SessionId;
  readonly text: string;
}

export interface AgentUsageEvent extends DomainEvent {
  readonly type: "agent.usage";
  readonly sessionId: SessionId;
  readonly usage: import("@ctrl-zebra/protocol").TokenUsage;
}

export interface AgentReasoningStartEvent extends DomainEvent {
  readonly type: "agent.reasoning-start";
  readonly sessionId: SessionId;
  readonly blockId: string;
}

export interface AgentReasoningDeltaEvent extends DomainEvent {
  readonly type: "agent.reasoning-delta";
  readonly sessionId: SessionId;
  readonly blockId: string;
  readonly text: string;
}

export interface AgentReasoningEndEvent extends DomainEvent {
  readonly type: "agent.reasoning-end";
  readonly sessionId: SessionId;
  readonly blockId: string;
}

export type AgentReasoningEvent =
  | AgentReasoningStartEvent
  | AgentReasoningDeltaEvent
  | AgentReasoningEndEvent;

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
  | AgentUsageEvent
  | AgentReasoningEvent
  | AgentToolStateEvent
  | AgentApprovalStateEvent
  | SessionStatusChangedEvent;

export interface AgentApprovalStateEvent extends DomainEvent {
  readonly type: "agent.approval-state";
  readonly sessionId: SessionId;
  readonly approval: ApprovalRequest;
  readonly status: ApprovalStatus;
}

export const defaultMaxToolSteps = 8;

export interface ModelHistoryProvider {
  load(
    sessionId: SessionId,
    signal: AbortSignal,
  ): readonly ModelMessage[] | Promise<readonly ModelMessage[]>;
}

export class SessionIdentityMismatchError extends Error {
  constructor(
    readonly expectedSessionId: SessionId,
    readonly actualSessionId: SessionId,
  ) {
    super("Agent Runtime cannot switch Sessions while it owns a Session.");
    this.name = "SessionIdentityMismatchError";
  }
}

export interface AgentRuntimeOptions {
  readonly maxToolSteps?: number;
  readonly toolRepetitionThreshold?: number;
  readonly approvalPolicy?: BasicApprovalPolicy;
  readonly approvalWorkflow?: ToolApprovalWorkflow;
  readonly contextWindowTokens?: number;
  readonly history?: readonly ModelMessage[];
  readonly historyProvider?: ModelHistoryProvider;
  readonly tokenCounter?: ModelMessageTokenCounter;
  readonly initialSessionStatus?: SessionStatus;
  readonly createRunId?: () => CheckpointRunId;
}

export interface AgentRuntimeRunOptions {
  readonly externalResources?: readonly McpResourceAttachment[];
  readonly externalPrompts?: readonly McpPromptConfirmation[];
}

export class MaxToolStepsExceededError extends Error {
  constructor(readonly maxToolSteps: number) {
    super(`Agent Runtime exceeded the maximum of ${maxToolSteps} Tool Call steps.`);
    this.name = "MaxToolStepsExceededError";
  }
}

export class EmptyAgentResponseError extends Error {
  constructor(readonly followedToolUse: boolean) {
    super(
      followedToolUse
        ? "The model completed after Tool use without a non-empty final text response."
        : "The model completed without a non-empty text response.",
    );
    this.name = "EmptyAgentResponseError";
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

class InvalidToolApprovalError extends Error {
  constructor() {
    super("Tool approval request is not bound to the current Session, Run, and Tool Call.");
    this.name = "InvalidToolApprovalError";
  }
}

let nextDefaultRunId = 0;

const maxHistoryMessageCharacters = 1_000_000;
const maxHistoryMessages = 10_000;

function createDefaultRunId(): CheckpointRunId {
  nextDefaultRunId += 1;
  return `run-${nextDefaultRunId}`;
}

export class AgentRuntime {
  readonly #modelGateway: ModelGateway;
  readonly #eventSink: EventSink<AgentRuntimeEvent>;
  readonly #toolRegistry: ToolRegistry;
  readonly #maxToolSteps: number;
  readonly #toolRepetitionThreshold: number;
  readonly #approvalPolicy: BasicApprovalPolicy;
  readonly #approvalWorkflow: ToolApprovalWorkflow | undefined;
  readonly #filesTokenBudget: number;
  readonly #history: readonly ModelMessage[];
  readonly #historyProvider: ModelHistoryProvider | undefined;
  readonly #tokenCounter: ModelMessageTokenCounter;
  readonly #historyTokenBudget: number;
  readonly #initialSessionStatus: SessionStatus;
  readonly #createRunId: () => CheckpointRunId;
  #session: SessionStateMachine | undefined;
  #sessionId: SessionId | undefined;

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
    this.#toolRepetitionThreshold = new ToolRepetitionDetector(
      options.toolRepetitionThreshold ?? defaultToolRepetitionThreshold,
    ).threshold;
    this.#approvalPolicy = options.approvalPolicy ?? new BasicApprovalPolicy();
    this.#approvalWorkflow = options.approvalWorkflow;
    const tokenBudget = allocateTokenBudget(
      options.contextWindowTokens ?? maxModelContextWindowTokens,
    );
    this.#filesTokenBudget = tokenBudget.filesTokens;
    this.#historyTokenBudget = tokenBudget.historyTokens;
    this.#history = options.history ?? [];
    this.#historyProvider = options.historyProvider;
    this.#tokenCounter = options.tokenCounter ?? defaultModelMessageTokenCounter;
    this.#initialSessionStatus = options.initialSessionStatus ?? "idle";
    this.#createRunId = options.createRunId ?? createDefaultRunId;
  }

  async run(
    userMessage: UserMessage,
    signal: AbortSignal,
    runOptions: AgentRuntimeRunOptions = {},
  ): Promise<void> {
    const session = this.#getSession(userMessage.sessionId);
    const runOwner = {};

    try {
      session.beginRun(runOwner);
      signal.throwIfAborted();
      const runId = this.#createRunId();
      signal.throwIfAborted();
      const history = await this.#loadHistory(userMessage.sessionId, signal);
      signal.throwIfAborted();
      const messages = this.#prepareMessages(history, userMessage.content, signal, runOptions);
      signal.throwIfAborted();
      const offerTools = shouldOfferWorkspaceTools(userMessage.content);
      session.transitionTo("streaming");
      signal.throwIfAborted();
      let toolSteps = 0;
      const repetitionDetector = new ToolRepetitionDetector(this.#toolRepetitionThreshold);
      const reasoningIds = new RunReasoningIds();

      while (true) {
        const response = await this.#streamModel(
          messages,
          userMessage.sessionId,
          signal,
          offerTools,
          reasoningIds,
          toolSteps,
          repetitionDetector,
        );
        if (response.toolCall === undefined) {
          if (!response.hasMeaningfulText) {
            throw new EmptyAgentResponseError(toolSteps > 0);
          }
          break;
        }

        const toolResult = await this.#executeTool(
          userMessage.sessionId,
          runId,
          response.toolCall,
          signal,
          session,
        );
        signal.throwIfAborted();
        this.#emitToolResult(userMessage.sessionId, response.toolCall, toolResult);
        signal.throwIfAborted();
        messages.push(
          { role: "assistant", toolCall: response.toolCall },
          { role: "tool", result: toolResult },
        );
        toolSteps += 1;
        signal.throwIfAborted();
        if (session.status === "executing_tool") {
          session.transitionTo("streaming");
          signal.throwIfAborted();
        }
      }

      signal.throwIfAborted();
      session.transitionTo("completed");
    } catch (error) {
      if (!session.ownsRun(runOwner)) {
        throw error;
      }

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

  #getSession(sessionId: SessionId): SessionStateMachine {
    if (this.#session === undefined) {
      this.#sessionId = sessionId;
      this.#session = new SessionStateMachine(
        sessionId,
        this.#initialSessionStatus,
        this.#eventSink,
      );
      return this.#session;
    }
    if (this.#sessionId !== sessionId) {
      throw new SessionIdentityMismatchError(this.#sessionId ?? sessionId, sessionId);
    }
    return this.#session;
  }

  async #loadHistory(sessionId: SessionId, signal: AbortSignal): Promise<readonly ModelMessage[]> {
    signal.throwIfAborted();
    const history =
      this.#historyProvider === undefined
        ? this.#history
        : await this.#historyProvider.load(sessionId, signal);
    signal.throwIfAborted();
    return validateModelHistory(history);
  }

  #prepareMessages(
    history: readonly ModelMessage[],
    content: string,
    signal: AbortSignal,
    runOptions: AgentRuntimeRunOptions,
  ): ModelMessage[] {
    signal.throwIfAborted();
    const withLatestUser: readonly ModelMessage[] = [...history, { role: "user", content }];
    const pruned = pruneModelHistory(withLatestUser, this.#historyTokenBudget, this.#tokenCounter);
    signal.throwIfAborted();

    const latestUser = withLatestUser.at(-1);
    if (latestUser === undefined || latestUser.role !== "user") {
      throw new InvalidModelHistoryError();
    }
    const retainedHistory = pruned.messages.slice(0, -1);
    const externalContext = projectExternalMcpContext(
      runOptions.externalResources ?? [],
      runOptions.externalPrompts ?? [],
      this.#filesTokenBudget,
      this.#tokenCounter,
    );
    signal.throwIfAborted();
    return [...retainedHistory, ...externalContext, latestUser];
  }

  async #streamModel(
    messages: readonly ModelMessage[],
    sessionId: SessionId,
    signal: AbortSignal,
    offerTools: boolean,
    reasoningIds: RunReasoningIds,
    toolSteps: number,
    repetitionDetector: ToolRepetitionDetector,
  ): Promise<{ readonly toolCall?: ToolCall; readonly hasMeaningfulText: boolean }> {
    let toolCall: ToolCall | undefined;
    let hasMeaningfulText = false;
    const toolDeclarations = offerTools ? this.#toolRegistry.declarations() : [];
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

    for await (const event of this.#modelGateway.stream(request, signal)) {
      signal.throwIfAborted();

      if (event.type === "text.delta") {
        if (event.text.trim() !== "") {
          hasMeaningfulText = true;
        }
        this.#eventSink.emit({
          type: "agent.text-delta",
          sessionId,
          text: event.text,
        });
        signal.throwIfAborted();
      } else if (event.type === "reasoning.start") {
        if (openReasoningBlock !== undefined || reasoningBlocks.has(event.blockId)) {
          throw new Error("ModelGateway emitted a malformed reasoning lifecycle.");
        }
        const runtimeBlockId = reasoningIds.next();
        reasoningBlocks.set(event.blockId, runtimeBlockId);
        openReasoningBlock = event.blockId;
        this.#eventSink.emit({
          type: "agent.reasoning-start",
          sessionId,
          blockId: runtimeBlockId,
        });
        signal.throwIfAborted();
      } else if (event.type === "reasoning.delta") {
        const runtimeBlockId = reasoningBlocks.get(event.blockId);
        if (event.blockId !== openReasoningBlock || runtimeBlockId === undefined) {
          throw new Error("ModelGateway emitted a malformed reasoning lifecycle.");
        }
        this.#eventSink.emit({
          type: "agent.reasoning-delta",
          sessionId,
          blockId: runtimeBlockId,
          text: event.text,
        });
        signal.throwIfAborted();
      } else if (event.type === "reasoning.end") {
        const runtimeBlockId = reasoningBlocks.get(event.blockId);
        if (event.blockId !== openReasoningBlock || runtimeBlockId === undefined) {
          throw new Error("ModelGateway emitted a malformed reasoning lifecycle.");
        }
        openReasoningBlock = undefined;
        this.#eventSink.emit({
          type: "agent.reasoning-end",
          sessionId,
          blockId: runtimeBlockId,
        });
        signal.throwIfAborted();
      } else if (event.type === "usage") {
        const usageResult = tokenUsageSchema.safeParse(event.usage);
        if (!usageResult.success) {
          throw new InvalidModelUsageError();
        }
        if (!usageSeen && hasTokenUsage(usageResult.data)) {
          usageSeen = true;
          this.#eventSink.emit({
            type: "agent.usage",
            sessionId,
            usage: normalizeTokenUsage(usageResult.data),
          });
          signal.throwIfAborted();
        }
      } else if (event.type === "tool.call") {
        if (!offerTools) {
          throw new UnexpectedToolCallError(event.call.name);
        }
        if (toolCall !== undefined) {
          throw new Error("AgentRuntime supports only one Tool Call per model response.");
        }
        if (toolSteps >= this.#maxToolSteps) {
          throw new MaxToolStepsExceededError(this.#maxToolSteps);
        }
        const repetition = repetitionDetector.observe(event.call);
        if (repetition.thresholdReached) {
          throw new ToolRepetitionDetectedError(
            event.call.name,
            repetition.consecutiveCount,
            repetitionDetector.threshold,
          );
        }

        toolCall = event.call;
        this.#emitToolState(sessionId, event.call, "pending");
        signal.throwIfAborted();
      } else if (event.type === "finish") {
        if (openReasoningBlock !== undefined) {
          throw new Error("ModelGateway completed with an open reasoning block.");
        }
        break;
      }
    }

    signal.throwIfAborted();
    if (openReasoningBlock !== undefined) {
      throw new Error("ModelGateway completed with an open reasoning block.");
    }
    return { ...(toolCall === undefined ? {} : { toolCall }), hasMeaningfulText };
  }

  async #executeTool(
    sessionId: SessionId,
    runId: CheckpointRunId,
    toolCall: ToolCall,
    signal: AbortSignal,
    session: SessionStateMachine,
  ): Promise<ToolResult> {
    const tool = this.#toolRegistry.get(toolCall.name);
    if (tool === undefined) {
      return createToolErrorResult(toolCall, "unknown-tool", `Unknown tool: ${toolCall.name}.`);
    }

    let input: unknown;
    try {
      input = parseToolInput(tool, toolCall.input);
    } catch (error) {
      if (error instanceof ToolUnavailableError) {
        return createToolErrorResult(
          toolCall,
          "unknown-tool",
          `Tool "${toolCall.name}" is no longer available.`,
        );
      }
      if (error instanceof InvalidToolInputError) {
        return createToolErrorResult(toolCall, error.code, error.message);
      }

      throw error;
    }

    signal.throwIfAborted();
    session.transitionTo("executing_tool");
    signal.throwIfAborted();
    this.#emitToolState(sessionId, toolCall, "running");
    signal.throwIfAborted();
    const disposition = this.#approvalPolicy.evaluate(tool.risk);
    if (disposition === "deny") {
      return createToolErrorResult(
        toolCall,
        "denied",
        `Tool "${toolCall.name}" is denied by policy.`,
      );
    }

    if (disposition === "require_approval") {
      return this.#executeApprovalRequiredTool(
        sessionId,
        runId,
        toolCall,
        tool,
        input,
        signal,
        session,
      );
    }

    return this.#executeToolImplementation(toolCall, tool, input, signal);
  }

  async #executeApprovalRequiredTool(
    sessionId: SessionId,
    runId: CheckpointRunId,
    toolCall: ToolCall,
    tool: NonNullable<ReturnType<ToolRegistry["get"]>>,
    input: unknown,
    signal: AbortSignal,
    session: SessionStateMachine,
  ): Promise<ToolResult> {
    if (tool.risk !== "write" && tool.risk !== "execute") {
      return createToolErrorResult(
        toolCall,
        "denied",
        `Tool "${toolCall.name}" cannot use the approval workflow for risk "${tool.risk}".`,
      );
    }
    if (tool.prepareApproval === undefined || this.#approvalWorkflow === undefined) {
      return createToolErrorResult(
        toolCall,
        "denied",
        `Tool "${toolCall.name}" requires an unavailable approval workflow.`,
      );
    }

    let prepared: ToolExecutionOutput<unknown>;
    try {
      prepared = await tool.prepareApproval(input, { signal });
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof ToolUnavailableError) {
        return createToolErrorResult(
          toolCall,
          "unknown-tool",
          `Tool "${toolCall.name}" is no longer available.`,
        );
      }
      return createToolErrorResult(
        toolCall,
        "failed",
        `Tool "${toolCall.name}" failed while preparing approval.`,
      );
    }

    signal.throwIfAborted();
    const operation = await this.#approvalWorkflow.create(
      {
        sessionId,
        runId,
        call: toolCall,
        risk: tool.risk,
        prepared,
      },
      signal,
    );
    try {
      signal.throwIfAborted();
      const approval = validateToolApproval(operation, sessionId, runId, toolCall, tool.risk);
      signal.throwIfAborted();
      session.transitionTo("streaming");
      signal.throwIfAborted();
      session.transitionTo("awaiting_approval");
      signal.throwIfAborted();
      this.#emitApprovalState(sessionId, approval, "pending");
      signal.throwIfAborted();
      const decision = await operation.requestDecision(signal);
      signal.throwIfAborted();

      if (decision.decision === "expired") {
        signal.throwIfAborted();
        this.#emitApprovalState(sessionId, approval, "expired");
        signal.throwIfAborted();
        session.transitionTo("streaming");
        signal.throwIfAborted();
        return createToolErrorResult(
          toolCall,
          "failed",
          `Approval for tool "${toolCall.name}" expired.`,
        );
      }

      if (decision.decision === "denied") {
        signal.throwIfAborted();
        this.#emitApprovalState(sessionId, approval, "denied");
        signal.throwIfAborted();
        session.transitionTo("streaming");
        signal.throwIfAborted();
        return createToolErrorResult(
          toolCall,
          "denied",
          `The user denied tool "${toolCall.name}".`,
        );
      }

      signal.throwIfAborted();
      this.#emitApprovalState(sessionId, approval, "approved");
      signal.throwIfAborted();
      session.transitionTo("executing_tool");
      signal.throwIfAborted();
      const consumption = await operation.consume(signal);
      signal.throwIfAborted();
      if (consumption.outcome === "expired") {
        signal.throwIfAborted();
        this.#emitApprovalState(sessionId, approval, "expired");
        signal.throwIfAborted();
        return createToolErrorResult(
          toolCall,
          "failed",
          `Approval for tool "${toolCall.name}" expired before use.`,
        );
      }
      if (consumption.outcome === "conflict") {
        signal.throwIfAborted();
        this.#emitApprovalState(sessionId, approval, "invalidated");
        signal.throwIfAborted();
        return createToolErrorResult(toolCall, "conflict", consumption.message);
      }

      signal.throwIfAborted();
      this.#emitApprovalState(sessionId, approval, "consumed");
      signal.throwIfAborted();
      if (tool.risk === "execute") {
        return this.#executeToolImplementation(toolCall, tool, input, signal);
      }

      return createApprovedToolResult(toolCall);
    } finally {
      operation.invalidate();
    }
  }

  async #executeToolImplementation(
    toolCall: ToolCall,
    tool: NonNullable<ReturnType<ToolRegistry["get"]>>,
    input: unknown,
    signal: AbortSignal,
  ): Promise<ToolResult> {
    let execution: ToolExecutionOutput<unknown>;
    try {
      execution = await tool.execute(input, { signal });
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof ToolUnavailableError) {
        return createToolErrorResult(
          toolCall,
          "unknown-tool",
          `Tool "${toolCall.name}" is no longer available.`,
        );
      }
      if (error instanceof ToolExecutionError) {
        return createToolErrorResult(toolCall, error.code, error.message);
      }
      return createToolErrorResult(
        toolCall,
        "failed",
        `Tool "${toolCall.name}" failed during execution.`,
      );
    }

    signal.throwIfAborted();
    const output = jsonValueSchema.safeParse(execution.output);
    if (!output.success) {
      return createToolErrorResult(
        toolCall,
        "invalid-output",
        `Tool "${toolCall.name}" returned invalid output.`,
      );
    }

    const limited = limitToolOutput(output.data);
    const result = toolResultSchema.safeParse({
      callId: toolCall.id,
      name: toolCall.name,
      status: "success",
      output: limited.output,
      truncated: execution.truncated || limited.truncated,
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

  #emitApprovalState(
    sessionId: SessionId,
    approval: ApprovalRequest,
    status: ApprovalStatus,
  ): void {
    this.#eventSink.emit({ type: "agent.approval-state", sessionId, approval, status });
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

function normalizeTokenUsage(
  usage: import("@ctrl-zebra/protocol").TokenUsage,
): import("@ctrl-zebra/protocol").TokenUsage {
  return {
    ...(usage.inputTokens === undefined ? {} : { inputTokens: usage.inputTokens }),
    ...(usage.outputTokens === undefined ? {} : { outputTokens: usage.outputTokens }),
    ...(usage.totalTokens === undefined ? {} : { totalTokens: usage.totalTokens }),
  };
}

class RunReasoningIds {
  #nextBlock = 1;

  next(): string {
    const blockId = `reasoning-${this.#nextBlock}`;
    this.#nextBlock += 1;
    return blockId;
  }
}

function createApprovedToolResult(toolCall: ToolCall): ToolResult {
  return {
    callId: toolCall.id,
    name: toolCall.name,
    status: "success",
    output: { outcome: "approved" },
    truncated: false,
  };
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

function validateModelHistory(history: unknown): readonly ModelMessage[] {
  if (!Array.isArray(history)) {
    throw new InvalidModelHistoryError();
  }
  if (history.length > maxHistoryMessages) {
    throw new InvalidModelHistoryError();
  }

  const validated: ModelMessage[] = [];
  for (let index = 0; index < history.length; index += 1) {
    if (!Object.hasOwn(history, index)) {
      throw new InvalidModelHistoryError();
    }
    validated.push(validateModelHistoryMessage(history[index]));
  }
  return validated;
}

function validateModelHistoryMessage(message: unknown): ModelMessage {
  if (!isRecord(message)) {
    throw new InvalidModelHistoryError();
  }

  if (hasExactKeys(message, ["content", "role"])) {
    if (
      (message.role !== "user" && message.role !== "assistant") ||
      typeof message.content !== "string" ||
      message.content.length < 1 ||
      message.content.length > maxHistoryMessageCharacters
    ) {
      throw new InvalidModelHistoryError();
    }

    return {
      role: message.role,
      content: message.content,
    };
  }

  if (hasExactKeys(message, ["role", "toolCall"])) {
    if (message.role !== "assistant") {
      throw new InvalidModelHistoryError();
    }
    const toolCall = toolCallSchema.safeParse(message.toolCall);
    if (!toolCall.success) {
      throw new InvalidModelHistoryError();
    }
    return { role: "assistant", toolCall: toolCall.data };
  }

  if (hasExactKeys(message, ["result", "role"])) {
    if (message.role !== "tool") {
      throw new InvalidModelHistoryError();
    }
    const result = toolResultSchema.safeParse(message.result);
    if (!result.success) {
      throw new InvalidModelHistoryError();
    }
    return { role: "tool", result: result.data };
  }

  throw new InvalidModelHistoryError();
}

function validateToolApproval(
  operation: ToolApprovalOperation,
  sessionId: SessionId,
  runId: CheckpointRunId,
  toolCall: ToolCall,
  risk: "write" | "execute",
): ApprovalRequest {
  const operationRecord =
    typeof operation === "object" && operation !== null
      ? (operation as { readonly request?: unknown })
      : undefined;
  const parsed = approvalRequestSchema.safeParse(operationRecord?.request);
  if (!parsed.success) {
    throw new InvalidToolApprovalError();
  }

  const scope = parsed.data.scope;
  if (
    scope.sessionId !== sessionId ||
    scope.runId !== runId ||
    scope.risk !== risk ||
    !toolCallsMatch(scope.call, toolCall)
  ) {
    throw new InvalidToolApprovalError();
  }

  return parsed.data;
}

function toolCallsMatch(left: ToolCall, right: ToolCall): boolean {
  return (
    left.id === right.id && left.name === right.name && jsonValuesEqual(left.input, right.input)
  );
}

function jsonValuesEqual(left: JsonValue, right: JsonValue): boolean {
  if (left === right) {
    return true;
  }
  if (typeof left !== typeof right || left === null || right === null) {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    return left.every((value, index) => {
      const other = right[index];
      return other !== undefined && jsonValuesEqual(value, other);
    });
  }
  if (typeof left === "object" && typeof right === "object") {
    const leftObject = left as { readonly [key: string]: JsonValue };
    const rightObject = right as { readonly [key: string]: JsonValue };
    const leftKeys = Object.keys(leftObject).sort();
    const rightKeys = Object.keys(rightObject).sort();
    if (
      leftKeys.length !== rightKeys.length ||
      leftKeys.some((key, index) => key !== rightKeys[index])
    ) {
      return false;
    }
    return leftKeys.every((key) => {
      return jsonValuesEqual(leftObject[key], rightObject[key]);
    });
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function isCancellation(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted && error === signal.reason;
}

function isActiveStatus(status: SessionStatus): boolean {
  return (
    status === "preparing" ||
    status === "streaming" ||
    status === "awaiting_approval" ||
    status === "executing_tool"
  );
}
