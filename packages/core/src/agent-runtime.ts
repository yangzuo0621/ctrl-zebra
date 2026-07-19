import {
  type ApprovalRequest,
  type ApprovalStatus,
  jsonValueSchema,
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
import { BasicApprovalPolicy } from "./approval-policy.js";
import type { DomainEvent, EventSink } from "./events.js";
import type { ModelGateway, ModelMessage } from "./model-gateway.js";
import { SessionStateMachine, type SessionStatusChangedEvent } from "./session-state-machine.js";
import type { ToolApprovalWorkflow } from "./tool-approval.js";
import { InvalidToolInputError, parseToolInput } from "./tool-input-validation.js";
import { limitToolOutput } from "./tool-output-limiter.js";
import { type ToolExecutionOutput, ToolRegistry } from "./tool-registry.js";
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
  | AgentApprovalStateEvent
  | SessionStatusChangedEvent;

export interface AgentApprovalStateEvent extends DomainEvent {
  readonly type: "agent.approval-state";
  readonly sessionId: SessionId;
  readonly approval: ApprovalRequest;
  readonly status: ApprovalStatus;
}

export const defaultMaxToolSteps = 8;

export interface AgentRuntimeOptions {
  readonly maxToolSteps?: number;
  readonly toolRepetitionThreshold?: number;
  readonly approvalPolicy?: BasicApprovalPolicy;
  readonly approvalWorkflow?: ToolApprovalWorkflow;
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
  readonly #toolRepetitionThreshold: number;
  readonly #approvalPolicy: BasicApprovalPolicy;
  readonly #approvalWorkflow: ToolApprovalWorkflow | undefined;

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
  }

  async run(userMessage: UserMessage, signal: AbortSignal): Promise<void> {
    const session = new SessionStateMachine(userMessage.sessionId, "idle", this.#eventSink);

    try {
      session.transitionTo("preparing");
      signal.throwIfAborted();
      const messages: ModelMessage[] = [{ role: "user", content: userMessage.content }];
      session.transitionTo("streaming");
      let toolSteps = 0;
      const repetitionDetector = new ToolRepetitionDetector(this.#toolRepetitionThreshold);

      while (true) {
        const toolCall = await this.#streamModel(messages, userMessage.sessionId, signal);
        if (toolCall === undefined) {
          break;
        }

        if (toolSteps >= this.#maxToolSteps) {
          throw new MaxToolStepsExceededError(this.#maxToolSteps);
        }

        const repetition = repetitionDetector.observe(toolCall);
        if (repetition.thresholdReached) {
          throw new ToolRepetitionDetectedError(
            toolCall.name,
            repetition.consecutiveCount,
            repetitionDetector.threshold,
          );
        }

        this.#emitToolState(userMessage.sessionId, toolCall, "pending");
        const toolResult = await this.#executeTool(
          userMessage.sessionId,
          userMessage.messageId,
          toolCall,
          signal,
          session,
        );
        this.#emitToolResult(userMessage.sessionId, toolCall, toolResult);
        messages.push({ role: "assistant", toolCall }, { role: "tool", result: toolResult });
        toolSteps += 1;
        signal.throwIfAborted();
        if (session.status === "executing_tool") {
          session.transitionTo("streaming");
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
    const toolDeclarations = this.#toolRegistry.declarations();
    const request =
      toolDeclarations.length === 0
        ? { messages: [...messages] }
        : { messages: [...messages], tools: toolDeclarations };

    for await (const event of this.#modelGateway.stream(request, signal)) {
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

  async #executeTool(
    sessionId: SessionId,
    runId: string,
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
      if (error instanceof InvalidToolInputError) {
        return createToolErrorResult(toolCall, error.code, error.message);
      }

      throw error;
    }

    signal.throwIfAborted();
    session.transitionTo("executing_tool");
    this.#emitToolState(sessionId, toolCall, "running");
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

  async #executeApprovalRequiredTool(
    sessionId: SessionId,
    runId: string,
    toolCall: ToolCall,
    tool: NonNullable<ReturnType<ToolRegistry["get"]>>,
    input: unknown,
    signal: AbortSignal,
    session: SessionStateMachine,
  ): Promise<ToolResult> {
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
    } catch {
      signal.throwIfAborted();
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
        risk: "write",
        prepared,
      },
      signal,
    );
    signal.throwIfAborted();
    session.transitionTo("streaming");
    session.transitionTo("awaiting_approval");
    this.#emitApprovalState(sessionId, operation.request, "pending");
    const decision = await operation.requestDecision(signal);
    signal.throwIfAborted();

    if (decision.decision === "expired") {
      this.#emitApprovalState(sessionId, operation.request, "expired");
      session.transitionTo("streaming");
      return createToolErrorResult(
        toolCall,
        "failed",
        `Approval for tool "${toolCall.name}" expired.`,
      );
    }

    if (decision.decision === "denied") {
      this.#emitApprovalState(sessionId, operation.request, "denied");
      session.transitionTo("streaming");
      return createToolErrorResult(toolCall, "denied", `The user denied tool "${toolCall.name}".`);
    }

    this.#emitApprovalState(sessionId, operation.request, "approved");
    session.transitionTo("executing_tool");
    const consumption = await operation.consume(signal);
    signal.throwIfAborted();
    if (consumption.outcome === "expired") {
      this.#emitApprovalState(sessionId, operation.request, "expired");
      return createToolErrorResult(
        toolCall,
        "failed",
        `Approval for tool "${toolCall.name}" expired before use.`,
      );
    }
    if (consumption.outcome === "conflict") {
      this.#emitApprovalState(sessionId, operation.request, "invalidated");
      return createToolErrorResult(toolCall, "conflict", consumption.message);
    }

    this.#emitApprovalState(sessionId, operation.request, "consumed");
    return {
      callId: toolCall.id,
      name: toolCall.name,
      status: "success",
      output: { outcome: "approved" },
      truncated: false,
    };
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
  return (
    status === "preparing" ||
    status === "streaming" ||
    status === "awaiting_approval" ||
    status === "executing_tool"
  );
}
