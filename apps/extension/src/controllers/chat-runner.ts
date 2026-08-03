import { randomUUID } from "node:crypto";

import {
  AgentRuntime,
  type AgentRuntimeEvent,
  allocateTokenBudget,
  type JsonValue,
  type ModelGateway,
  maxModelContextWindowTokens,
  projectExternalMcpContext,
  type SessionRepository,
  type ToolApprovalWorkflow,
  ToolRegistry,
} from "@ctrl-zebra/core";
import {
  jsonValueSchema,
  type McpPromptConfirmation,
  type McpResourceAttachment,
  type PersistedMcpToolSource,
  persistenceFormatVersion,
  type ToolStateSourceDto,
  type UserMessage,
} from "@ctrl-zebra/protocol";

import {
  type CollectedReasoningEvent,
  isRuntimeReasoningEvent,
  ReasoningCollector,
} from "./reasoning-collector.js";

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
type RuntimeMcpToolSource = PersistedMcpToolSource & { readonly displayName?: string };
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
  ): Promise<void>;
}

interface ChatRunnerDependencies {
  readonly modelGateway: ModelGateway;
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
  toolRegistry,
  createId = randomUUID,
  now = () => new Date(),
  approvalWorkflow,
  sessionRepository,
  mcpToolSources,
}: ChatRunnerDependencies): ChatRunner {
  return {
    async run(content, signal, emit, externalResources = [], externalPrompts = []) {
      signal.throwIfAborted();
      projectExternalMcpContext(
        externalResources,
        externalPrompts,
        allocateTokenBudget(maxModelContextWindowTokens).filesTokens,
      );
      const sessionId = createId();
      const userMessage: UserMessage = {
        messageId: createId(),
        sessionId,
        createdAt: now().toISOString(),
        role: "user",
        content,
      };
      const reasoning = new ReasoningCollector(sessionId);
      if (sessionRepository === undefined) {
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
            externalResources,
            externalPrompts,
          },
        );
        try {
          await runtime.run(userMessage, signal);
        } finally {
          reasoning.close();
        }
        return;
      }

      await sessionRepository.create({
        formatVersion: persistenceFormatVersion,
        sessionId,
        status: "idle",
        createdAt: userMessage.createdAt,
        updatedAt: userMessage.createdAt,
        lastEventSequence: 0,
      });
      let sequence = 1;
      await sessionRepository.appendEvent(sessionId, {
        sequence,
        recordedAt: userMessage.createdAt,
        event: {
          type: "session.user-message",
          data: jsonValueSchema.parse({ ...userMessage }),
        },
      });
      for (const attachment of externalResources) {
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
          externalResources,
          externalPrompts,
        },
      );

      try {
        await runtime.run(userMessage, signal);
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
    (event.status === "completed" || event.status === "cancelled" || event.status === "failed")
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
  selectToolRegistry = async () => new ToolRegistry(),
  createId,
  now,
  approvalWorkflow,
  selectSessionRepository,
}: SelectingChatRunnerDependencies): ChatRunner {
  return {
    async run(content, signal, emit, externalResources = [], externalPrompts = []) {
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
        sessionRepository,
        mcpToolSources: selection.mcpToolSources,
      }).run(content, signal, emit, externalResources, externalPrompts);
    },
  };
}

function projectPersistedEvents(
  event: ChatRunnerEvent,
  sources: ReadonlyMap<string, RuntimeMcpToolSource> | undefined,
): readonly { readonly type: string; readonly data: JsonValue }[] {
  const { type, sessionId: _sessionId, ...rawData } = event;
  const data = event.type === "agent.tool-state" ? omitUiSource(rawData) : rawData;
  const events: { readonly type: string; readonly data: JsonValue }[] = [
    { type, data: jsonValueSchema.parse(data) },
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
      data: jsonValueSchema.parse({ call: event.call, source: persistedSource(source) }),
    });
  } else if (event.status === "success" || event.status === "error") {
    events.push({
      type: "session.mcp-tool-result",
      data: jsonValueSchema.parse({ result: event.result, source: persistedSource(source) }),
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
