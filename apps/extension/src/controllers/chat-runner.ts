import { randomUUID } from "node:crypto";

import { AgentRuntime, type AgentRuntimeEvent, type ModelGateway } from "@ctrl-zebra/core";
import type { UserMessage } from "@ctrl-zebra/protocol";
import { createOpenAIModelGateway } from "@ctrl-zebra/providers";

import type { ApiKeySecretStorage } from "../adapters/api-key-secret-storage.js";

const defaultOpenAIModelId = "gpt-5.6-terra";

export interface ChatRunner {
  run(
    content: string,
    signal: AbortSignal,
    emit: (event: AgentRuntimeEvent) => void,
  ): Promise<void>;
}

interface ChatRunnerDependencies {
  readonly apiKeyStorage: ApiKeySecretStorage;
  readonly requestApiKey: (signal: AbortSignal) => Promise<string | undefined>;
  readonly createGateway?: (apiKey: string) => ModelGateway;
  readonly createId?: () => string;
  readonly now?: () => Date;
}

export class ApiKeyRequiredError extends Error {
  constructor() {
    super("An OpenAI API key is required to start a chat.");
    this.name = "ApiKeyRequiredError";
  }
}

export function createChatRunner({
  apiKeyStorage,
  requestApiKey,
  createGateway = (apiKey) => createOpenAIModelGateway({ apiKey, modelId: defaultOpenAIModelId }),
  createId = randomUUID,
  now = () => new Date(),
}: ChatRunnerDependencies): ChatRunner {
  return {
    async run(content, signal, emit) {
      signal.throwIfAborted();
      let apiKey = await apiKeyStorage.read();
      signal.throwIfAborted();

      if (apiKey === undefined) {
        apiKey = await requestApiKey(signal);
        signal.throwIfAborted();

        if (apiKey === undefined || apiKey.trim().length === 0) {
          throw new ApiKeyRequiredError();
        }

        await apiKeyStorage.save(apiKey);
        signal.throwIfAborted();
      }

      const sessionId = createId();
      const userMessage: UserMessage = {
        messageId: createId(),
        sessionId,
        createdAt: now().toISOString(),
        role: "user",
        content,
      };
      const runtime = new AgentRuntime(createGateway(apiKey), { emit });

      await runtime.run(userMessage, signal);
    },
  };
}
