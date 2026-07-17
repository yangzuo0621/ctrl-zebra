import { createOpenAI } from "@ai-sdk/openai";
import type { ModelGateway } from "@ctrl-zebra/core";

import { createAISDKModelGateway, noRedirectFetch } from "./ai-sdk-model-gateway.js";

export interface OpenAIModelGatewayOptions {
  readonly apiKey: string;
  readonly modelId: string;
  readonly baseURL?: string;
}

export function createOpenAIModelGateway(options: OpenAIModelGatewayOptions): ModelGateway {
  const provider = createOpenAI({
    apiKey: options.apiKey,
    baseURL: options.baseURL,
    fetch: noRedirectFetch,
  });

  return createAISDKModelGateway(provider(options.modelId));
}
