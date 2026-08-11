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
  projectExternalMcpContext,
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
  type SessionStatus,
  sessionIdSchema,
  type ToolStateSourceDto,
  type UserMessage,
} from "@ctrl-zebra/protocol";

import {
  type CollectedReasoningEvent,
  isRuntimeReasoningEvent,
  ReasoningCollector,
} from "./reasoning-collector.js";
import { projectSessionModelHistory, SessionHistoryCorruptError } from "./session-history.js";
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
}: ChatRunnerDependencies): ChatRunner {
  return {
    async run(
      content,
      signal,
      emit,
      externalResources = [],
      externalPrompts = [],
      requestedSessionId,
    ) {
      signal.throwIfAborted();
      projectExternalMcpContext(
        externalResources,
        externalPrompts,
        allocateTokenBudget(maxModelContextWindowTokens).filesTokens,
      );
      const normalizedRequestedSessionId =
        requestedSessionId === undefined ? undefined : parseRequestedSessionId(requestedSessionId);
      let existingRecord: SessionRecord | undefined;
      let history: readonly ModelMessage[] = [];
      let initialSessionStatus: SessionStatus = "idle";
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
        if (isActiveSessionStatus(existingRecord.manifest.status)) {
          throw new SessionRecoveryError("unavailable");
        }
        try {
          history = projectSessionModelHistory(existingRecord);
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
          },
        );
        try {
          signal.throwIfAborted();
          await runtime.run(userMessage, signal, { externalResources, externalPrompts });
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
        await runtime.run(userMessage, signal, { externalResources, externalPrompts });
      } finally {
        reasoning.close();
        await persistence;
      }
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

export function createSelectingChatRunner({
  selectModelGateway,
  diagnosticSink,
  selectToolRegistry = async () => new ToolRegistry(),
  createId,
  now,
  approvalWorkflow,
  selectSessionRepository,
}: SelectingChatRunnerDependencies): ChatRunner {
  return {
    async run(content, signal, emit, externalResources = [], externalPrompts = [], sessionId) {
      signal.throwIfAborted();
      const sessionRepository = await selectSessionRepository?.();
      signal.throwIfAborted();
      const selected = await selectToolRegistry(signal);
      const selection = selected instanceof ToolRegistry ? { registry: selected } : selected;
      signal.throwIfAborted();
      const modelGateway = await selectModelGateway();
      signal.throwIfAborted();

      await createChatRunner({
        modelGateway,
        toolRegistry: selection.registry,
        createId,
        now,
        approvalWorkflow,
        diagnosticSink,
        sessionRepository,
        mcpToolSources: selection.mcpToolSources,
      }).run(content, signal, emit, externalResources, externalPrompts, sessionId);
    },
  };
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
        : rawData;
  const events: { readonly type: string; readonly data: JsonValue }[] = [
    {
      type: event.type === "agent.usage" ? "session.usage" : type,
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
