import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { ModelGateway } from "@ctrl-zebra/core";

import { createAISDKModelGateway, noRedirectFetch } from "./ai-sdk-model-gateway.js";

export interface OpenAICompatibleModelGatewayOptions {
  readonly apiKey?: string;
  readonly baseURL: string;
  readonly modelId: string;
}

export function createOpenAICompatibleModelGateway(
  options: OpenAICompatibleModelGatewayOptions,
): ModelGateway {
  const provider = createOpenAICompatible({
    apiKey: options.apiKey,
    baseURL: options.baseURL,
    fetch: noRedirectFetch,
    includeUsage: true,
    name: "ctrl-zebra-openai-compatible",
  });

  return createAISDKModelGateway(provider.chatModel(options.modelId));
}
