import type {
  CheckpointRunId,
  McpPromptConfirmation,
  McpResourceAttachment,
  RunTokenBudgetConfiguration,
  SessionId,
  SessionStatus,
  ToolCall,
  ToolResult,
  UserMessage,
  WorkspaceFileReference,
} from "@ctrl-zebra/protocol";
import { shouldOfferWorkspaceTools } from "./agent-behavior-policy.js";
import { BasicApprovalPolicy } from "./approval-policy.js";
import { recoverFromContextOverflow } from "./context-overflow-recovery.js";
import type { AgentRuntimeDiagnosticSink, AgentRuntimeEvent, EventSink } from "./events.js";
import { projectExternalContext } from "./external-resource-context.js";
import { defaultModelMessageTokenCounter } from "./heuristic-token-counter.js";
import {
  estimateModelMessages,
  InvalidModelHistoryError,
  type ModelMessageTokenCounter,
  pruneModelHistory,
  validateModelHistory,
} from "./history-pruner.js";
import type { ModelGateway, ModelMessage } from "./model-gateway.js";
import { ModelTurnStream, type ModelTurnStreamResult } from "./model-turn-stream.js";
import {
  InvalidRunTokenBudgetError,
  RunTokenBudget,
  RunTokenBudgetExceededError,
  RunTokenBudgetGuard,
} from "./run-token-budget.js";
import { SessionStateMachine } from "./session-state-machine.js";
import { allocateTokenBudget, maxModelContextWindowTokens } from "./token-budget.js";
import type { ToolApprovalWorkflow } from "./tool-approval.js";
import { ToolCallExecution } from "./tool-call-execution.js";
import { ToolRegistry } from "./tool-registry.js";
import {
  defaultToolRepetitionThreshold,
  ToolRepetitionDetector,
} from "./tool-repetition-detector.js";

export type {
  AgentApprovalStateEvent,
  AgentReasoningDeltaEvent,
  AgentReasoningEndEvent,
  AgentReasoningEvent,
  AgentReasoningStartEvent,
  AgentRunBudgetEvent,
  AgentRuntimeDiagnostic,
  AgentRuntimeDiagnosticPhase,
  AgentRuntimeDiagnosticSink,
  AgentRuntimeEvent,
  AgentTextDeltaEvent,
  AgentToolStateEvent,
  AgentUsageEvent,
} from "./events.js";
export {
  InvalidModelUsageError,
  MaxToolStepsExceededError,
  UnexpectedToolCallError,
} from "./model-turn-stream.js";
export { RunTokenBudgetExceededError } from "./run-token-budget.js";

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
  readonly diagnosticSink?: AgentRuntimeDiagnosticSink;
  readonly runTokenBudget?: RunTokenBudgetConfiguration;
}

export interface AgentRuntimeRunOptions {
  readonly workspaceFiles?: readonly WorkspaceFileReference[];
  readonly externalResources?: readonly McpResourceAttachment[];
  readonly externalPrompts?: readonly McpPromptConfirmation[];
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

type ModelStepResult =
  | {
      readonly outcome: "response";
      readonly messages: readonly ModelMessage[];
      readonly toolCall?: ToolCall;
      readonly hasMeaningfulText: boolean;
    }
  | {
      readonly outcome: "truncated";
      readonly messages: readonly ModelMessage[];
    };

let nextDefaultRunId = 0;

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
  readonly #filesTokenBudget: number;
  readonly #history: readonly ModelMessage[];
  readonly #historyProvider: ModelHistoryProvider | undefined;
  readonly #tokenCounter: ModelMessageTokenCounter;
  readonly #historyTokenBudget: number;
  readonly #initialSessionStatus: SessionStatus;
  readonly #createRunId: () => CheckpointRunId;
  readonly #runTokenBudgetConfiguration: RunTokenBudgetConfiguration | undefined;
  readonly #toolCallExecution: ToolCallExecution;
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
    const approvalPolicy = options.approvalPolicy ?? new BasicApprovalPolicy();
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
    this.#toolCallExecution = new ToolCallExecution(
      this.#toolRegistry,
      approvalPolicy,
      options.approvalWorkflow,
      this.#eventSink,
      options.diagnosticSink,
    );
    if (options.runTokenBudget === undefined) {
      this.#runTokenBudgetConfiguration = undefined;
    } else {
      try {
        this.#runTokenBudgetConfiguration = new RunTokenBudget(
          options.runTokenBudget,
        ).configuration;
      } catch (error) {
        if (error instanceof InvalidRunTokenBudgetError) {
          throw error;
        }
        throw new InvalidRunTokenBudgetError();
      }
    }
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
      const runBudget = new RunTokenBudgetGuard(this.#runTokenBudgetConfiguration, (budget) => {
        this.#eventSink.emit({
          type: "agent.run-budget",
          sessionId: userMessage.sessionId,
          budget,
        });
      });
      signal.throwIfAborted();
      const history = await this.#loadHistory(userMessage.sessionId, signal);
      signal.throwIfAborted();
      let messages = this.#prepareMessages(history, userMessage.content, signal, runOptions);
      signal.throwIfAborted();
      const offerTools = shouldOfferWorkspaceTools(userMessage.content);
      session.transitionTo("streaming");
      signal.throwIfAborted();
      let toolSteps = 0;
      const modelTurn = new ModelTurnStream(
        this.#modelGateway,
        this.#eventSink,
        this.#toolRegistry,
        this.#tokenCounter,
        runBudget,
        userMessage.sessionId,
        signal,
        offerTools,
        this.#maxToolSteps,
        this.#toolRepetitionThreshold,
      );

      while (true) {
        const response = await this.#streamWithOverflowRecovery(
          messages,
          signal,
          toolSteps,
          modelTurn,
          runBudget,
        );
        messages = [...response.messages];
        if (response.outcome === "truncated") {
          signal.throwIfAborted();
          session.transitionTo("truncated");
          return;
        }
        if (response.toolCall === undefined) {
          if (!response.hasMeaningfulText) {
            throw new EmptyAgentResponseError(toolSteps > 0);
          }
          break;
        }

        const toolResult = await this.#toolCallExecution.execute(
          userMessage.sessionId,
          runId,
          response.toolCall,
          signal,
          session,
        );
        signal.throwIfAborted();
        this.#emitToolResult(userMessage.sessionId, response.toolCall, toolResult);
        signal.throwIfAborted();
        runBudget.observeEstimate(
          this.#tokenCounter.count({ role: "tool", result: toolResult }),
          signal,
        );
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

      if (error instanceof RunTokenBudgetExceededError) {
        if (isActiveStatus(session.status)) {
          session.transitionTo("budget-exceeded");
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
    const externalContext = projectExternalContext(
      runOptions.workspaceFiles ?? [],
      runOptions.externalResources ?? [],
      runOptions.externalPrompts ?? [],
      this.#filesTokenBudget,
      this.#tokenCounter,
    );
    signal.throwIfAborted();
    return [...retainedHistory, ...externalContext, latestUser];
  }

  async #streamWithOverflowRecovery(
    messages: readonly ModelMessage[],
    signal: AbortSignal,
    toolSteps: number,
    modelTurn: ModelTurnStream,
    runBudget: RunTokenBudgetGuard,
  ): Promise<ModelStepResult> {
    runBudget.observeEstimate(estimateModelMessages(messages, this.#tokenCounter), signal);
    const first = await modelTurn.stream(messages, toolSteps);
    if (first.outcome !== "overflow") {
      return { ...first, messages };
    }

    const recovered = await recoverFromContextOverflow<
      Exclude<ModelTurnStreamResult, { readonly outcome: "overflow" }>
    >(
      { messages, maxHistoryTokens: this.#historyTokenBudget },
      {
        tokenCounter: this.#tokenCounter,
        retry: {
          retry: async (recoveryMessages, retrySignal) => {
            runBudget.observeEstimate(
              estimateModelMessages(recoveryMessages, this.#tokenCounter),
              retrySignal,
            );
            const retry = await modelTurn.stream(recoveryMessages, toolSteps);
            return retry.outcome === "overflow"
              ? { outcome: "overflow" }
              : { outcome: "success", value: retry };
          },
        },
      },
      signal,
    );
    return { ...recovered.value, messages: recovered.messages };
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
