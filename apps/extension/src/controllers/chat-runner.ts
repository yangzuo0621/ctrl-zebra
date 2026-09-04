import { randomUUID } from "node:crypto";

import {
  AgentRuntime,
  type AgentRuntimeDiagnosticSink,
  type AgentRuntimeEvent,
  allocateTokenBudget,
  CorruptEventLogError,
  EventLogLimitExceededError,
  InconsistentSessionRecordError,
  InvalidSessionManifestError,
  type JsonValue,
  type ModelGateway,
  type ModelMessage,
  maxModelContextWindowTokens,
  projectExternalContext,
  ReadOnlySessionError,
  SessionNotFoundError,
  type SessionRecord,
  type SessionRepository,
  type ToolApprovalWorkflow,
  ToolRegistry,
} from "@ctrl-zebra/core";
import {
  jsonValueSchema,
  type McpNegotiatedProvenanceDto,
  type McpPromptConfirmation,
  type McpResourceAttachment,
  type PersistedMcpToolSource,
  persistenceFormatVersion,
  type RunTokenBudgetConfiguration,
  type SessionStatus,
  sessionIdSchema,
  type ToolStateSourceDto,
  type UserMessage,
  type WorkspaceFileReference,
} from "@ctrl-zebra/protocol";

import {
  type CollectedReasoningEvent,
  isRuntimeReasoningEvent,
  ReasoningCollector,
} from "./reasoning-collector.js";
import {
  projectEditContext,
  projectRegenerationContext,
  projectSessionModelHistory,
  SessionHistoryCorruptError,
} from "./session-history.js";
import { SessionRecoveryError } from "./session-recovery.js";

type NonReasoningAgentRuntimeEvent = Exclude<
  AgentRuntimeEvent,
  {
    readonly type: "agent.reasoning-start" | "agent.reasoning-delta" | "agent.reasoning-end";
  }
>;

type RuntimeToolStateEvent = Extract<
  NonReasoningAgentRuntimeEvent,
  { readonly type: "agent.tool-state" }
>;
type RuntimeMcpToolSource = PersistedMcpToolSource & {
  readonly displayName?: string;
  readonly provenance?: McpNegotiatedProvenanceDto;
};
export type ChatRunnerEvent =
  | Exclude<NonReasoningAgentRuntimeEvent, { readonly type: "agent.tool-state" }>
  | (RuntimeToolStateEvent & { readonly source?: ToolStateSourceDto })
  | CollectedReasoningEvent;

export interface ChatRunner {
  run(
    content: string,
    signal: AbortSignal,
    emit: (event: ChatRunnerEvent) => void,
    externalResources?: readonly McpResourceAttachment[],
    externalPrompts?: readonly McpPromptConfirmation[],
    sessionId?: string,
    workspaceFiles?: readonly WorkspaceFileReference[],
  ): Promise<void>;
  regenerate?(
    sessionId: string,
    targetAssistantMessageId: string,
    signal: AbortSignal,
    emit: (event: ChatRunnerEvent) => void,
  ): Promise<void>;
  edit?(
    sessionId: string,
    targetUserMessageId: string,
    content: string,
    signal: AbortSignal,
    emit: (event: ChatRunnerEvent) => void,
  ): Promise<void>;
}

interface ChatRunnerDependencies {
  readonly modelGateway: ModelGateway;
  readonly diagnosticSink?: AgentRuntimeDiagnosticSink;
  readonly toolRegistry?: ToolRegistry;
  readonly createId?: () => string;
  readonly now?: () => Date;
  readonly approvalWorkflow?: ToolApprovalWorkflow;
  readonly sessionRepository?: SessionRepository;
  readonly mcpToolSources?: ReadonlyMap<string, RuntimeMcpToolSource>;
  readonly runTokenBudget?: RunTokenBudgetConfiguration;
}

interface SelectedToolRegistry {
  readonly registry: ToolRegistry;
  readonly mcpToolSources?: ReadonlyMap<string, RuntimeMcpToolSource>;
}

interface SelectingChatRunnerDependencies {
  readonly selectModelGateway: () => Promise<ModelGateway>;
  readonly diagnosticSink?: AgentRuntimeDiagnosticSink;
  readonly selectToolRegistry?: (
    signal: AbortSignal,
  ) => Promise<ToolRegistry | SelectedToolRegistry>;
  readonly createId?: () => string;
  readonly now?: () => Date;
  readonly approvalWorkflow?: ToolApprovalWorkflow;
  readonly selectSessionRepository?: () => Promise<SessionRepository>;
  readonly readRunTokenBudget?: () => RunTokenBudgetConfiguration;
}

interface InternalRunOptions {
  readonly regenerationTargetMessageId?: string;
  readonly editTargetUserMessageId?: string;
}

export function createChatRunner({
  modelGateway,
  diagnosticSink,
  toolRegistry,
  createId = randomUUID,
  now = () => new Date(),
  approvalWorkflow,
  sessionRepository,
  mcpToolSources,
  runTokenBudget,
}: ChatRunnerDependencies): ChatRunner {
  const runInternal = async (
    content: string,
    signal: AbortSignal,
    emit: (event: ChatRunnerEvent) => void,
    externalResources: readonly McpResourceAttachment[] = [],
    externalPrompts: readonly McpPromptConfirmation[] = [],
    requestedSessionId: string | undefined,
    workspaceFiles: readonly WorkspaceFileReference[] = [],
    options: InternalRunOptions = {},
  ): Promise<void> => {
    signal.throwIfAborted();
    projectExternalContext(
      workspaceFiles,
      externalResources,
      externalPrompts,
      allocateTokenBudget(maxModelContextWindowTokens).filesTokens,
    );
    const normalizedRequestedSessionId =
      requestedSessionId === undefined ? undefined : parseRequestedSessionId(requestedSessionId);
    let existingRecord: SessionRecord | undefined;
    let history: readonly ModelMessage[] = [];
    let initialSessionStatus: SessionStatus = "idle";
    let persistedRegenerationTargetMessageId: string | undefined;
    let persistedEditTargetUserMessageId: string | undefined;
    if (normalizedRequestedSessionId !== undefined) {
      if (sessionRepository === undefined) {
        throw new SessionRecoveryError("unavailable");
      }
      try {
        existingRecord = await sessionRepository.get(normalizedRequestedSessionId);
      } catch (error) {
        if (signal.aborted) {
          signal.throwIfAborted();
        }
        throw toContinuationError(error);
      }
      signal.throwIfAborted();
      if (existingRecord === undefined) {
        throw new SessionRecoveryError("not-found");
      }
      if (existingRecord.eventLogTailDamaged) {
        throw new SessionRecoveryError("corrupt");
      }
      if (existingRecord.readOnly === true) {
        throw new ReadOnlySessionError(existingRecord.manifest.sessionId);
      }
      if (isActiveSessionStatus(existingRecord.manifest.status)) {
        throw new SessionRecoveryError("unavailable");
      }
      try {
        if (options.regenerationTargetMessageId !== undefined) {
          const regeneration = projectRegenerationContext(
            existingRecord,
            options.regenerationTargetMessageId,
          );
          history = regeneration.history;
          content = regeneration.targetUserMessage.content;
          persistedRegenerationTargetMessageId = regeneration.targetAssistantMessageId;
        } else if (options.editTargetUserMessageId !== undefined) {
          const edit = projectEditContext(existingRecord, options.editTargetUserMessageId);
          history = edit.history;
          persistedEditTargetUserMessageId = edit.targetUserMessageId;
        } else {
          history = projectSessionModelHistory(existingRecord);
        }
      } catch (error) {
        if (error instanceof SessionHistoryCorruptError) {
          throw new SessionRecoveryError("corrupt");
        }
        throw error;
      }
      initialSessionStatus = existingRecord.manifest.status;
    }

    signal.throwIfAborted();
    const sessionId = normalizedRequestedSessionId ?? createId();
    signal.throwIfAborted();
    const userMessage: UserMessage = {
      messageId: createId(),
      sessionId,
      createdAt: now().toISOString(),
      role: "user",
      content,
    };
    const reasoning = new ReasoningCollector(sessionId);
    if (sessionRepository === undefined) {
      signal.throwIfAborted();
      const runtime = new AgentRuntime(
        modelGateway,
        {
          emit: (event) => {
            for (const projected of projectRuntimeEvent(
              sessionId,
              signal,
              reasoning,
              event,
              mcpToolSources,
            )) {
              emit(projected);
            }
          },
        },
        toolRegistry,
        {
          approvalWorkflow,
          diagnosticSink,
          runTokenBudget,
        },
      );
      try {
        signal.throwIfAborted();
        await runtime.run(userMessage, signal, {
          workspaceFiles,
          externalResources,
          externalPrompts,
        });
      } finally {
        reasoning.close();
      }
      return;
    }

    let sequence: number;
    if (existingRecord === undefined) {
      signal.throwIfAborted();
      await sessionRepository.create({
        formatVersion: persistenceFormatVersion,
        sessionId,
        status: "idle",
        createdAt: userMessage.createdAt,
        updatedAt: userMessage.createdAt,
        lastEventSequence: 0,
      });
      signal.throwIfAborted();
      sequence = 1;
    } else {
      sequence =
        (existingRecord.events.at(-1)?.sequence ?? existingRecord.manifest.lastEventSequence) + 1;
    }
    signal.throwIfAborted();
    await sessionRepository.appendEvent(sessionId, {
      sequence,
      recordedAt: userMessage.createdAt,
      event: {
        type: "session.user-message",
        data: jsonValueSchema.parse({ ...userMessage }),
      },
    });
    for (const attachment of externalResources) {
      signal.throwIfAborted();
      sequence += 1;
      await sessionRepository.appendEvent(sessionId, {
        sequence,
        recordedAt: userMessage.createdAt,
        event: {
          type: "session.mcp-resource-attached",
          data: jsonValueSchema.parse(attachment),
        },
      });
    }
    for (const confirmation of externalPrompts) {
      signal.throwIfAborted();
      sequence += 1;
      await sessionRepository.appendEvent(sessionId, {
        sequence,
        recordedAt: userMessage.createdAt,
        event: {
          type: "session.mcp-prompt-confirmed",
          data: jsonValueSchema.parse(confirmation),
        },
      });
    }
    if (persistedRegenerationTargetMessageId !== undefined) {
      signal.throwIfAborted();
      sequence += 1;
      await sessionRepository.appendEvent(sessionId, {
        sequence,
        recordedAt: userMessage.createdAt,
        event: {
          type: "session.regeneration",
          data: jsonValueSchema.parse({
            targetMessageId: persistedRegenerationTargetMessageId,
            replacementUserMessageId: userMessage.messageId,
          }),
        },
      });
    }
    if (persistedEditTargetUserMessageId !== undefined) {
      signal.throwIfAborted();
      sequence += 1;
      await sessionRepository.appendEvent(sessionId, {
        sequence,
        recordedAt: userMessage.createdAt,
        event: {
          type: "session.edit",
          data: jsonValueSchema.parse({
            targetMessageId: persistedEditTargetUserMessageId,
            replacementUserMessageId: userMessage.messageId,
          }),
        },
      });
    }
    let persistence = Promise.resolve();
    const persist = (event: ChatRunnerEvent) => {
      emit(event);
      for (const persistedEvent of projectPersistedEvents(event, mcpToolSources)) {
        sequence += 1;
        const eventSequence = sequence;
        const recordedAt = now().toISOString();
        persistence = persistence.then(() =>
          sessionRepository.appendEvent(sessionId, {
            sequence: eventSequence,
            recordedAt,
            event: persistedEvent,
          }),
        );
        if (event.type === "session.status-changed") {
          persistence = persistence.then(() =>
            sessionRepository.update(sessionId, { status: event.status, updatedAt: recordedAt }),
          );
        }
      }
    };
    const runtime = new AgentRuntime(
      modelGateway,
      {
        emit: (event) => {
          for (const projected of projectRuntimeEvent(
            sessionId,
            signal,
            reasoning,
            event,
            mcpToolSources,
          )) {
            persist(projected);
          }
        },
      },
      toolRegistry,
      {
        approvalWorkflow,
        diagnosticSink,
        runTokenBudget,
        ...(existingRecord === undefined
          ? {}
          : {
              initialSessionStatus,
              historyProvider: { load: () => history },
            }),
      },
    );

    try {
      signal.throwIfAborted();
      await runtime.run(userMessage, signal, {
        workspaceFiles,
        externalResources,
        externalPrompts,
      });
    } finally {
      reasoning.close();
      await persistence;
    }
  };

  return {
    run: runInternal,
    async regenerate(sessionId, targetAssistantMessageId, signal, emit) {
      if (sessionRepository === undefined) {
        throw new SessionRecoveryError("unavailable");
      }
      await runInternal("regenerate", signal, emit, [], [], sessionId, [], {
        regenerationTargetMessageId: targetAssistantMessageId,
      });
    },
    async edit(sessionId, targetUserMessageId, content, signal, emit) {
      if (sessionRepository === undefined) {
        throw new SessionRecoveryError("unavailable");
      }
      await runInternal(content, signal, emit, [], [], sessionId, [], {
        editTargetUserMessageId: targetUserMessageId,
      });
    },
  };
}

function projectRuntimeEvent(
  sessionId: string,
  signal: AbortSignal,
  reasoning: ReasoningCollector,
  event: AgentRuntimeEvent,
  sources: ReadonlyMap<string, RuntimeMcpToolSource> | undefined,
): readonly ChatRunnerEvent[] {
  if (event.sessionId !== sessionId) {
    return [];
  }
  if (isRuntimeReasoningEvent(event)) {
    return signal.aborted ? [] : reasoning.accept(event);
  }
  if (
    event.type === "session.status-changed" &&
    (event.status === "completed" ||
      event.status === "truncated" ||
      event.status === "cancelled" ||
      event.status === "budget-exceeded" ||
      event.status === "failed")
  ) {
    reasoning.close();
  }
  if (event.type === "agent.tool-state") {
    const source = sources?.get(event.call.name);
    return [
      {
        ...event,
        source:
          source === undefined
            ? { kind: "builtin" }
            : {
                kind: "mcp",
                server: {
                  serverId: source.serverId,
                  displayName: source.displayName ?? source.serverId,
                },
                generation: source.generation,
                mcpToolName: source.mcpToolName,
              },
      },
    ];
  }
  return [event];
}

export function createSelectingChatRunner(
  dependencies: SelectingChatRunnerDependencies,
): ChatRunner {
  return {
    async run(
      content,
      signal,
      emit,
      externalResources = [],
      externalPrompts = [],
      sessionId,
      workspaceFiles = [],
    ) {
      const runner = await selectChatRunner(dependencies, signal);
      await runner.run(
        content,
        signal,
        emit,
        externalResources,
        externalPrompts,
        sessionId,
        workspaceFiles,
      );
    },
    async regenerate(sessionId, targetAssistantMessageId, signal, emit) {
      const runner = await selectChatRunner(dependencies, signal);
      if (runner.regenerate === undefined) {
        throw new SessionRecoveryError("unavailable");
      }
      await runner.regenerate(sessionId, targetAssistantMessageId, signal, emit);
    },
    async edit(sessionId, targetUserMessageId, content, signal, emit) {
      const runner = await selectChatRunner(dependencies, signal);
      if (runner.edit === undefined) {
        throw new SessionRecoveryError("unavailable");
      }
      await runner.edit(sessionId, targetUserMessageId, content, signal, emit);
    },
  };
}

/**
 * Resolves the current model gateway, Tool registry, and Session repository, then builds the
 * ChatRunner that uses them. Every SelectingChatRunner operation (run, regenerate, edit) needs
 * this exact selection sequence before it can act; only what it does with the result differs.
 */
async function selectChatRunner(
  {
    selectModelGateway,
    diagnosticSink,
    selectToolRegistry = async () => new ToolRegistry(),
    createId,
    now,
    approvalWorkflow,
    selectSessionRepository,
    readRunTokenBudget,
  }: SelectingChatRunnerDependencies,
  signal: AbortSignal,
): Promise<ChatRunner> {
  signal.throwIfAborted();
  const sessionRepository = await selectSessionRepository?.();
  signal.throwIfAborted();
  const runTokenBudget = readRunTokenBudget?.();
  signal.throwIfAborted();
  const selected = await selectToolRegistry(signal);
  const selection = selected instanceof ToolRegistry ? { registry: selected } : selected;
  signal.throwIfAborted();
  const modelGateway = await selectModelGateway();
  signal.throwIfAborted();

  return createChatRunner({
    modelGateway,
    toolRegistry: selection.registry,
    createId,
    now,
    approvalWorkflow,
    diagnosticSink,
    runTokenBudget,
    sessionRepository,
    mcpToolSources: selection.mcpToolSources,
  });
}

function parseRequestedSessionId(value: string): string {
  const result = sessionIdSchema.safeParse(value);
  if (!result.success) {
    throw new SessionRecoveryError("not-found");
  }
  return result.data;
}

function isActiveSessionStatus(status: SessionStatus): boolean {
  return (
    status === "preparing" ||
    status === "streaming" ||
    status === "awaiting_approval" ||
    status === "executing_tool"
  );
}

function toContinuationError(error: unknown): SessionRecoveryError {
  if (error instanceof SessionRecoveryError) {
    return error;
  }
  if (error instanceof SessionNotFoundError) {
    return new SessionRecoveryError("not-found");
  }
  if (
    error instanceof InvalidSessionManifestError ||
    error instanceof CorruptEventLogError ||
    error instanceof EventLogLimitExceededError ||
    error instanceof InconsistentSessionRecordError
  ) {
    return new SessionRecoveryError("corrupt");
  }
  return new SessionRecoveryError("unavailable");
}

function projectPersistedEvents(
  event: ChatRunnerEvent,
  sources: ReadonlyMap<string, RuntimeMcpToolSource> | undefined,
): readonly { readonly type: string; readonly data: JsonValue }[] {
  const { type, sessionId: _sessionId, ...rawData } = event;
  const data =
    event.type === "agent.tool-state"
      ? omitUiSource(rawData)
      : event.type === "agent.usage"
        ? event.usage
        : event.type === "agent.run-budget"
          ? event.budget
          : rawData;
  const events: { readonly type: string; readonly data: JsonValue }[] = [
    {
      type:
        event.type === "agent.usage"
          ? "session.usage"
          : event.type === "agent.run-budget"
            ? "session.run-budget"
            : type,
      data: jsonValueSchema.parse(data),
    },
  ];
  if (event.type !== "agent.tool-state") {
    return events;
  }
  const source = sources?.get(event.call.name);
  if (source === undefined) {
    return events;
  }
  if (event.status === "pending") {
    events.push({
      type: "session.mcp-tool-call",
      data: jsonValueSchema.parse({
        call: event.call,
        source: persistedSource(source),
        ...(source.provenance === undefined ? {} : { provenance: source.provenance }),
      }),
    });
  } else if (event.status === "success" || event.status === "error") {
    events.push({
      type: "session.mcp-tool-result",
      data: jsonValueSchema.parse({
        result: event.result,
        source: persistedSource(source),
        ...(source.provenance === undefined ? {} : { provenance: source.provenance }),
      }),
    });
  }
  return events;
}

function omitUiSource<T extends object>({
  source: _source,
  ...value
}: T & { readonly source?: unknown }) {
  return value;
}

function persistedSource(source: RuntimeMcpToolSource): PersistedMcpToolSource {
  return {
    serverId: source.serverId,
    registryName: source.registryName,
    mcpToolName: source.mcpToolName,
    generation: source.generation,
  };
}
