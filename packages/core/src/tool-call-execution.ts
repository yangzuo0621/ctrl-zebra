import {
  type ApprovalRequest,
  type ApprovalStatus,
  approvalRequestSchema,
  type CheckpointRunId,
  jsonValueSchema,
  type SessionId,
  type ToolCall,
  type ToolErrorCode,
  type ToolResult,
  toolResultSchema,
} from "@ctrl-zebra/protocol";
import type { BasicApprovalPolicy } from "./approval-policy.js";
import type {
  AgentRuntimeDiagnostic,
  AgentRuntimeDiagnosticSink,
  AgentRuntimeEvent,
  EventSink,
} from "./events.js";
import { jsonValuesEqual } from "./json-values.js";
import type { SessionStateMachine } from "./session-state-machine.js";
import type { ToolApprovalOperation, ToolApprovalWorkflow } from "./tool-approval.js";
import { InvalidToolInputError, parseToolInput } from "./tool-input-validation.js";
import { limitToolOutput } from "./tool-output-limiter.js";
import {
  ToolExecutionError,
  type ToolExecutionOutput,
  type ToolRegistry,
  ToolUnavailableError,
} from "./tool-registry.js";

class InvalidToolApprovalError extends Error {
  constructor() {
    super("Tool approval request is not bound to the current Session, Run, and Tool Call.");
    this.name = "InvalidToolApprovalError";
  }
}

/**
 * Resolves one Tool Call through input validation, policy, exact one-time approval, execution,
 * output normalization, and safe diagnostics. AgentRuntime retains the surrounding model loop.
 */
export class ToolCallExecution {
  readonly #toolRegistry: ToolRegistry;
  readonly #approvalPolicy: BasicApprovalPolicy;
  readonly #approvalWorkflow: ToolApprovalWorkflow | undefined;
  readonly #eventSink: EventSink<AgentRuntimeEvent>;
  readonly #diagnosticSink: AgentRuntimeDiagnosticSink | undefined;

  constructor(
    toolRegistry: ToolRegistry,
    approvalPolicy: BasicApprovalPolicy,
    approvalWorkflow: ToolApprovalWorkflow | undefined,
    eventSink: EventSink<AgentRuntimeEvent>,
    diagnosticSink: AgentRuntimeDiagnosticSink | undefined,
  ) {
    this.#toolRegistry = toolRegistry;
    this.#approvalPolicy = approvalPolicy;
    this.#approvalWorkflow = approvalWorkflow;
    this.#eventSink = eventSink;
    this.#diagnosticSink = diagnosticSink;
  }

  async execute(
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

    return this.#executeToolImplementation(sessionId, runId, toolCall, tool, input, signal);
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
      this.#reportDiagnostic({
        type: "agent.internal-error",
        phase: "prepare-approval",
        sessionId,
        runId,
        toolCallId: toolCall.id,
        cause: error,
      });
      return createToolErrorResult(
        toolCall,
        "failed",
        `Tool "${toolCall.name}" failed while preparing approval.`,
      );
    }

    signal.throwIfAborted();
    const operation = await this.#approvalWorkflow.create(
      { sessionId, runId, call: toolCall, risk: tool.risk, prepared },
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
        return this.#executeToolImplementation(sessionId, runId, toolCall, tool, input, signal);
      }
      return consumption.outcome === "applied"
        ? createAppliedToolResult(toolCall)
        : createApprovedToolResult(toolCall);
    } finally {
      operation.invalidate();
    }
  }

  async #executeToolImplementation(
    sessionId: SessionId,
    runId: CheckpointRunId,
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
      this.#reportDiagnostic({
        type: "agent.internal-error",
        phase: "execute-tool",
        sessionId,
        runId,
        toolCallId: toolCall.id,
        cause: error,
      });
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
    return result.success
      ? result.data
      : createToolErrorResult(
          toolCall,
          "invalid-output",
          `Tool "${toolCall.name}" returned invalid output.`,
        );
  }

  #reportDiagnostic(diagnostic: AgentRuntimeDiagnostic): void {
    if (this.#diagnosticSink === undefined) {
      return;
    }
    try {
      this.#diagnosticSink.emit(diagnostic);
    } catch {
      // The Host owns logging; a broken diagnostic sink cannot change safe Tool behavior.
    }
  }

  #emitToolState(sessionId: SessionId, call: ToolCall, status: "running"): void {
    this.#eventSink.emit({ type: "agent.tool-state", sessionId, call, status });
  }

  #emitApprovalState(
    sessionId: SessionId,
    approval: ApprovalRequest,
    status: ApprovalStatus,
  ): void {
    this.#eventSink.emit({ type: "agent.approval-state", sessionId, approval, status });
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

function createAppliedToolResult(toolCall: ToolCall): ToolResult {
  return {
    callId: toolCall.id,
    name: toolCall.name,
    status: "success",
    output: { outcome: "applied" },
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
