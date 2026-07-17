import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { ModelGateway } from "@ctrl-zebra/core";

import { createAISDKModelGateway, noRedirectFetch } from "./ai-sdk-model-gateway.js";

export interface GeminiModelGatewayOptions {
  readonly apiKey: string;
  readonly modelId: string;
  readonly baseURL?: string;
}

export function createGeminiModelGateway(options: GeminiModelGatewayOptions): ModelGateway {
  const provider = createGoogleGenerativeAI({
    apiKey: options.apiKey,
    baseURL: options.baseURL,
    fetch: noRedirectFetch,
  });

  return createAISDKModelGateway(provider(options.modelId));
}
