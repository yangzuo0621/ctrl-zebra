import { type ModelEvent, type ModelGateway, RetryingModelGateway } from "@ctrl-zebra/core";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

import type { ProviderApiKeySecretReader } from "../adapters/api-key-secret-storage.js";
import type {
  GeminiProviderConfiguration,
  OpenAICompatibleProviderConfiguration,
  OpenAIProviderConfiguration,
  ProviderConfiguration,
} from "../adapters/provider-configuration.js";
import {
  getProviderSetupErrorMessage,
  MissingProviderApiKeyError,
  ProviderAdapterUnavailableError,
  type ProviderCapabilityMismatchError,
  type ProviderGatewayFactories,
  selectModelGateway,
} from "./model-gateway-selector.js";

const gateways = {
  openai: gateway("openai"),
  gemini: gateway("gemini"),
  "openai-compatible": gateway("openai-compatible"),
} as const;

const request = {
  messages: [{ role: "user", content: "Hello" }],
} as const;

function gateway(text: string): ModelGateway {
  return {
    async *stream() {
      yield { type: "text.delta", text };
      yield { type: "finish", reason: "stop" };
    },
  };
}

function configuration(provider: ProviderConfiguration["provider"]): ProviderConfiguration {
  if (provider === "openai-compatible") {
    return {
      version: 1,
      provider,
      modelId: "compatible-test-model",
      endpoint: "https://models.example.test/v1",
      capabilities: ["text-streaming"],
      requiresApiKey: true,
    };
  }

  return {
    version: 1,
    provider,
    modelId: `${provider}-test-model`,
    capabilities: ["text-streaming", "tool-calling"],
  };
}

describe("ModelGateway selector", () => {
  it("narrows each keyed factory to its Provider configuration", () => {
    const factories = {
      openai: ({ configuration: selected, apiKey }) => {
        expectTypeOf(selected).toEqualTypeOf<OpenAIProviderConfiguration>();
        expectTypeOf(apiKey).toEqualTypeOf<string>();
        return gateways.openai;
      },
      gemini: ({ configuration: selected, apiKey }) => {
        expectTypeOf(selected).toEqualTypeOf<GeminiProviderConfiguration>();
        expectTypeOf(apiKey).toEqualTypeOf<string>();
        return gateways.gemini;
      },
      "openai-compatible": ({ configuration: selected, apiKey }) => {
        expectTypeOf(selected).toEqualTypeOf<OpenAICompatibleProviderConfiguration>();
        expectTypeOf(apiKey).toEqualTypeOf<string | undefined>();
        return gateways["openai-compatible"];
      },
    } satisfies ProviderGatewayFactories;

    expect(factories).toBeDefined();
  });

  it.each([
    "openai",
    "gemini",
    "openai-compatible",
  ] as const)("selects the %s factory with validated configuration and its credential", async (provider) => {
    const factory = vi.fn(() => gateways[provider]);
    const secrets: ProviderApiKeySecretReader = {
      read: vi.fn(async () => `test-${provider}-api-key`),
    };

    const selected = await selectModelGateway({
      configuration: configuration(provider),
      requiredCapabilities: ["text-streaming"],
      secrets,
      factories: { [provider]: factory },
    });

    expect(selected).toBeInstanceOf(RetryingModelGateway);
    expect((selected as RetryingModelGateway).gateway).toBe(gateways[provider]);
    await expect(collect(selected.stream(request, new AbortController().signal))).resolves.toEqual([
      { type: "text.delta", text: provider },
      { type: "finish", reason: "stop" },
    ]);
    expect(secrets.read).toHaveBeenCalledWith(provider);
    expect(factory).toHaveBeenCalledWith({
      configuration: configuration(provider),
      apiKey: `test-${provider}-api-key`,
    });
  });

  it("allows an explicit local compatible endpoint without a credential", async () => {
    const localConfiguration: ProviderConfiguration = {
      version: 1,
      provider: "openai-compatible",
      modelId: "compatible-test-model",
      endpoint: "http://localhost:11434/v1",
      capabilities: ["text-streaming"],
      requiresApiKey: false,
    };
    const factory = vi.fn(() => gateways["openai-compatible"]);
    const secrets: ProviderApiKeySecretReader = { read: vi.fn() };

    const selected = await selectModelGateway({
      configuration: localConfiguration,
      requiredCapabilities: ["text-streaming"],
      secrets,
      factories: { "openai-compatible": factory },
    });

    expect(selected).toBeInstanceOf(RetryingModelGateway);
    expect((selected as RetryingModelGateway).gateway).toBe(gateways["openai-compatible"]);
    expect(secrets.read).not.toHaveBeenCalled();
    expect(factory).toHaveBeenCalledWith({ configuration: localConfiguration, apiKey: undefined });
  });

  it.each([undefined, ""])("rejects a missing required credential", async (apiKey) => {
    const secrets: ProviderApiKeySecretReader = { read: vi.fn(async () => apiKey) };
    const factory = vi.fn(() => gateways.openai);

    await expect(
      selectModelGateway({
        configuration: configuration("openai"),
        requiredCapabilities: ["text-streaming"],
        secrets,
        factories: { openai: factory },
      }),
    ).rejects.toBeInstanceOf(MissingProviderApiKeyError);
    expect(factory).not.toHaveBeenCalled();
  });

  it("rejects a capability mismatch before Secret access", async () => {
    const secrets: ProviderApiKeySecretReader = { read: vi.fn() };
    const factory = vi.fn(() => gateways["openai-compatible"]);

    await expect(
      selectModelGateway({
        configuration: configuration("openai-compatible"),
        requiredCapabilities: ["tool-calling"],
        secrets,
        factories: { "openai-compatible": factory },
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<ProviderCapabilityMismatchError>>({
        missingCapabilities: ["tool-calling"],
      }),
    );
    expect(secrets.read).not.toHaveBeenCalled();
    expect(factory).not.toHaveBeenCalled();
  });

  it("reports a Provider whose adapter factory is unavailable", async () => {
    const secrets: ProviderApiKeySecretReader = { read: vi.fn() };

    await expect(
      selectModelGateway({
        configuration: configuration("openai-compatible"),
        requiredCapabilities: ["text-streaming"],
        secrets,
        factories: {} satisfies ProviderGatewayFactories,
      }),
    ).rejects.toBeInstanceOf(ProviderAdapterUnavailableError);
    expect(secrets.read).not.toHaveBeenCalled();
  });

  it("exposes only known user-safe setup errors for prompting", () => {
    expect(getProviderSetupErrorMessage(new MissingProviderApiKeyError("openai"))).toBe(
      "Save an API key for the openai model provider before starting a chat.",
    );
    expect(
      getProviderSetupErrorMessage(new Error("SDK response included a secret")),
    ).toBeUndefined();
  });
});

async function collect(events: AsyncIterable<ModelEvent>): Promise<readonly ModelEvent[]> {
  const collected: ModelEvent[] = [];
  for await (const event of events) {
    collected.push(event);
  }
  return collected;
}
