import type { ModelGateway } from "@ctrl-zebra/core";
import { describe, expect, it, vi } from "vitest";

import type { ProviderApiKeySecretReader } from "../adapters/api-key-secret-storage.js";
import type { ProviderConfiguration } from "../adapters/provider-configuration.js";
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
  it.each([
    "openai",
    "gemini",
    "openai-compatible",
  ] as const)("selects the %s factory with validated configuration and its credential", async (provider) => {
    const factory = vi.fn(() => gateways[provider]);
    const secrets: ProviderApiKeySecretReader = {
      read: vi.fn(async () => `test-${provider}-api-key`),
    };

    await expect(
      selectModelGateway({
        configuration: configuration(provider),
        requiredCapabilities: ["text-streaming"],
        secrets,
        factories: { [provider]: factory },
      }),
    ).resolves.toBe(gateways[provider]);
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

    await expect(
      selectModelGateway({
        configuration: localConfiguration,
        requiredCapabilities: ["text-streaming"],
        secrets,
        factories: { "openai-compatible": factory },
      }),
    ).resolves.toBe(gateways["openai-compatible"]);
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

  it("reports a Provider whose adapter belongs to a later task", async () => {
    const secrets: ProviderApiKeySecretReader = { read: vi.fn() };

    await expect(
      selectModelGateway({
        configuration: configuration("gemini"),
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
