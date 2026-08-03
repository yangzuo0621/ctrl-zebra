import { randomUUID } from "node:crypto";

import {
  AgentRuntime,
  type AgentRuntimeEvent,
  allocateTokenBudget,
  type JsonValue,
  type ModelGateway,
  maxModelContextWindowTokens,
  projectExternalResourceContext,
  type SessionRepository,
  type ToolApprovalWorkflow,
  ToolRegistry,
} from "@ctrl-zebra/core";
import {
  jsonValueSchema,
  type McpResourceAttachment,
  type PersistedMcpToolSource,
  persistenceFormatVersion,
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

export type ChatRunnerEvent = NonReasoningAgentRuntimeEvent | CollectedReasoningEvent;

export interface ChatRunner {
  run(
    content: string,
    signal: AbortSignal,
    emit: (event: ChatRunnerEvent) => void,
    externalResources?: readonly McpResourceAttachment[],
  ): Promise<void>;
}

interface ChatRunnerDependencies {
  readonly modelGateway: ModelGateway;
  readonly toolRegistry?: ToolRegistry;
  readonly createId?: () => string;
  readonly now?: () => Date;
  readonly approvalWorkflow?: ToolApprovalWorkflow;
  readonly sessionRepository?: SessionRepository;
  readonly mcpToolSources?: ReadonlyMap<string, PersistedMcpToolSource>;
}

interface SelectedToolRegistry {
  readonly registry: ToolRegistry;
  readonly mcpToolSources?: ReadonlyMap<string, PersistedMcpToolSource>;
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
    async run(content, signal, emit, externalResources = []) {
      signal.throwIfAborted();
      projectExternalResourceContext(
        externalResources,
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
              for (const projected of projectRuntimeEvent(sessionId, signal, reasoning, event)) {
                emit(projected);
              }
            },
          },
          toolRegistry,
          {
            approvalWorkflow,
            externalResources,
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
            for (const projected of projectRuntimeEvent(sessionId, signal, reasoning, event)) {
              persist(projected);
            }
          },
        },
        toolRegistry,
        {
          approvalWorkflow,
          externalResources,
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
    async run(content, signal, emit, externalResources = []) {
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
      }).run(content, signal, emit, externalResources);
    },
  };
}

function projectPersistedEvents(
  event: ChatRunnerEvent,
  sources: ReadonlyMap<string, PersistedMcpToolSource> | undefined,
): readonly { readonly type: string; readonly data: JsonValue }[] {
  const { type, sessionId: _sessionId, ...data } = event;
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
      data: jsonValueSchema.parse({ call: event.call, source }),
    });
  } else if (event.status === "success" || event.status === "error") {
    events.push({
      type: "session.mcp-tool-result",
      data: jsonValueSchema.parse({ result: event.result, source }),
    });
  }
  return events;
}
