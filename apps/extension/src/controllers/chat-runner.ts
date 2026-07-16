import { randomUUID } from "node:crypto";

import { AgentRuntime, type AgentRuntimeEvent, type ModelGateway } from "@ctrl-zebra/core";
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
  readonly createId?: () => string;
  readonly now?: () => Date;
}

export class ModelProviderNotConfiguredError extends Error {
  constructor() {
    super("A model provider must be configured before starting a chat.");
    this.name = "ModelProviderNotConfiguredError";
  }
}

export function createChatRunner({
  modelGateway,
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
      const runtime = new AgentRuntime(modelGateway, { emit });

      await runtime.run(userMessage, signal);
    },
  };
}

export function createUnconfiguredChatRunner(): ChatRunner {
  return {
    async run(_content, signal) {
      signal.throwIfAborted();
      throw new ModelProviderNotConfiguredError();
    },
  };
}
