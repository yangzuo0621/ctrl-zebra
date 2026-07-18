import { randomUUID } from "node:crypto";

import {
  AgentRuntime,
  type AgentRuntimeEvent,
  type ModelGateway,
  ToolRegistry,
} from "@ctrl-zebra/core";
import type { UserMessage } from "@ctrl-zebra/protocol";

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
}

interface SelectingChatRunnerDependencies {
  readonly selectModelGateway: () => Promise<ModelGateway>;
  readonly selectToolRegistry?: (signal: AbortSignal) => Promise<ToolRegistry>;
  readonly createId?: () => string;
  readonly now?: () => Date;
}

export function createChatRunner({
  modelGateway,
  toolRegistry,
  createId = randomUUID,
  now = () => new Date(),
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
      const runtime = new AgentRuntime(modelGateway, { emit }, toolRegistry);

      await runtime.run(userMessage, signal);
    },
  };
}

export function createSelectingChatRunner({
  selectModelGateway,
  selectToolRegistry = async () => new ToolRegistry(),
  createId,
  now,
}: SelectingChatRunnerDependencies): ChatRunner {
  return {
    async run(content, signal, emit) {
      signal.throwIfAborted();
      const toolRegistry = await selectToolRegistry(signal);
      signal.throwIfAborted();
      const modelGateway = await selectModelGateway();
      signal.throwIfAborted();

      await createChatRunner({ modelGateway, toolRegistry, createId, now }).run(
        content,
        signal,
        emit,
      );
    },
  };
}
