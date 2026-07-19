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

export interface ChatRunner {
  run(
    content: string,
    signal: AbortSignal,
    emit: (event: AgentRuntimeEvent) => void,
  ): Promise<void>;
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
      if (sessionRepository === undefined) {
        const runtime = new AgentRuntime(modelGateway, { emit }, toolRegistry, {
          approvalWorkflow,
        });
        await runtime.run(userMessage, signal);
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
      const persist = (event: AgentRuntimeEvent) => {
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
      const runtime = new AgentRuntime(modelGateway, { emit: persist }, toolRegistry, {
        approvalWorkflow,
      });

      try {
        await runtime.run(userMessage, signal);
      } finally {
        await persistence;
      }
    },
  };
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
