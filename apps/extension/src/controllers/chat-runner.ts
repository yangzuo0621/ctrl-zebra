import { randomUUID } from "node:crypto";

import {
  AgentRuntime,
  type AgentRuntimeEvent,
  type ModelGateway,
  type SessionRepository,
  type ToolApprovalWorkflow,
  ToolRegistry,
} from "@ctrl-zebra/core";
import { jsonValueSchema, persistenceFormatVersion, type UserMessage } from "@ctrl-zebra/protocol";

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
  run(content: string, signal: AbortSignal, emit: (event: ChatRunnerEvent) => void): Promise<void>;
}

interface ChatRunnerDependencies {
  readonly modelGateway: ModelGateway;
  readonly toolRegistry?: ToolRegistry;
  readonly createId?: () => string;
  readonly now?: () => Date;
  readonly approvalWorkflow?: ToolApprovalWorkflow;
  readonly sessionRepository?: SessionRepository;
}

interface SelectingChatRunnerDependencies {
  readonly selectModelGateway: () => Promise<ModelGateway>;
  readonly selectToolRegistry?: (signal: AbortSignal) => Promise<ToolRegistry>;
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
}: ChatRunnerDependencies): ChatRunner {
  return {
    async run(content, signal, emit) {
      signal.throwIfAborted();
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
      let persistence = Promise.resolve();
      const persist = (event: ChatRunnerEvent) => {
        emit(event);
        sequence += 1;
        const eventSequence = sequence;
        const recordedAt = now().toISOString();
        const { type, sessionId: _sessionId, ...data } = event;
        persistence = persistence
          .then(() =>
            sessionRepository.appendEvent(sessionId, {
              sequence: eventSequence,
              recordedAt,
              event: { type, data: jsonValueSchema.parse(data) },
            }),
          )
          .then(() =>
            event.type === "session.status-changed"
              ? sessionRepository.update(sessionId, { status: event.status, updatedAt: recordedAt })
              : undefined,
          );
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
    async run(content, signal, emit) {
      signal.throwIfAborted();
      const sessionRepository = await selectSessionRepository?.();
      signal.throwIfAborted();
      const toolRegistry = await selectToolRegistry(signal);
      signal.throwIfAborted();
      const modelGateway = await selectModelGateway();
      signal.throwIfAborted();

      await createChatRunner({
        modelGateway,
        toolRegistry,
        createId,
        now,
        approvalWorkflow,
        sessionRepository,
      }).run(content, signal, emit);
    },
  };
}
