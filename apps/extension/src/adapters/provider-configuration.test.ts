import { describe, expect, it } from "vitest";

import {
  type ConfigurationReader,
  ProviderConfigurationError,
  readProviderConfiguration,
  readProviderOnboardingConfiguration,
  readProviderSelectionConfiguration,
} from "./provider-configuration.js";

function configuration(values: Readonly<Record<string, unknown>>): ConfigurationReader {
  return { get: (setting) => values[setting] };
}

describe("Provider configuration", () => {
  it.each([
    ["openai", ["text-streaming", "tool-calling"]],
    ["gemini", ["text-streaming", "tool-calling"]],
  ] as const)("normalizes a valid %s configuration", (provider, capabilities) => {
    expect(
      readProviderConfiguration(configuration({ id: provider, model: `${provider}-test-model` })),
    ).toEqual({
      version: 1,
      provider,
      modelId: `${provider}-test-model`,
      endpoint: undefined,
      capabilities,
    });
  });

  it("defaults the Provider to OpenAI but requires an explicit model", () => {
    expect(readProviderConfiguration(configuration({ model: "gpt-test" }))).toMatchObject({
      provider: "openai",
      modelId: "gpt-test",
    });
    expect(() => readProviderConfiguration(configuration({}))).toThrowError(
      expect.objectContaining({ code: "missing-model", setting: "model" }),
    );
  });

  it("reads the Provider selection target without requiring an existing model", () => {
    expect(readProviderSelectionConfiguration(configuration({ id: "gemini" }))).toEqual({
      provider: "gemini",
      modelId: undefined,
      endpoint: undefined,
    });
  });

  it("retains a valid existing model while reading a custom selection target", () => {
    expect(
      readProviderSelectionConfiguration(
        configuration({
          id: "openai",
          model: "gpt-test",
          endpoint: "https://models.example.test/v1",
        }),
      ),
    ).toEqual({
      provider: "openai",
      modelId: "gpt-test",
      endpoint: "https://models.example.test/v1",
    });
  });

  it("allows model selection to repair an invalid model value", () => {
    expect(
      readProviderSelectionConfiguration(configuration({ id: "openai", model: " invalid " })),
    ).toMatchObject({ provider: "openai", modelId: undefined });
  });

  it.each([
    ["openai", { id: "openai", model: "gpt-test" }, true, true],
    ["gemini without a model", { id: "gemini" }, true, false],
    [
      "remote OpenAI-Compatible",
      { id: "openai-compatible", model: "compatible-test", endpoint: "https://models.example/v1" },
      true,
      true,
    ],
    [
      "loopback OpenAI-Compatible",
      { id: "openai-compatible", model: "compatible-test", endpoint: "http://127.0.0.1:11434/v1" },
      false,
      true,
    ],
    [
      "OpenAI-Compatible without an endpoint",
      { id: "openai-compatible", model: "compatible-test" },
      true,
      true,
    ],
  ] as const)(
    "projects bounded onboarding facts for %s",
    (_name, values, apiKeyRequired, modelConfigured) => {
      expect(readProviderOnboardingConfiguration(configuration(values))).toMatchObject({
        provider: values.id,
        apiKeyRequired,
        modelConfigured,
        endpointValid: values.id !== "openai-compatible" || "endpoint" in values,
      });
    },
  );

  it("tolerates malformed optional endpoints without returning their value", () => {
    expect(
      readProviderOnboardingConfiguration(
        configuration({
          id: "openai",
          model: "gpt-test",
          endpoint: "http://user:secret@example.test",
        }),
      ),
    ).toEqual({
      provider: "openai",
      apiKeyRequired: true,
      modelConfigured: true,
      endpointValid: false,
    });
  });

  it("uses the endpoint policy decision for a compatible configuration", () => {
    expect(
      readProviderConfiguration(
        configuration({
          id: "openai-compatible",
          model: "compatible-test-model",
          endpoint: "https://models.example.test/v1",
          capabilities: ["text-streaming"],
        }),
      ),
    ).toEqual({
      version: 1,
      provider: "openai-compatible",
      modelId: "compatible-test-model",
      endpoint: "https://models.example.test/v1",
      capabilities: ["text-streaming"],
      requiresApiKey: true,
    });
  });

  it("defaults OpenAI-Compatible to text streaming", () => {
    expect(
      readProviderConfiguration(
        configuration({
          id: "openai-compatible",
          model: "compatible-test-model",
          endpoint: "https://models.example.test/v1",
        }),
      ).capabilities,
    ).toEqual(["text-streaming"]);
  });

  it.each([
    ["unknown provider", { id: "other", model: "test" }, "unknown-provider"],
    ["missing model", { id: "openai" }, "missing-model"],
    ["invalid model", { id: "gemini", model: " gemini-test" }, "invalid-model"],
    ["missing compatible endpoint", { id: "openai-compatible", model: "test" }, "missing-endpoint"],
    [
      "unknown capability",
      {
        id: "openai-compatible",
        model: "test",
        endpoint: "https://models.example/v1",
        capabilities: ["vision"],
      },
      "invalid-capabilities",
    ],
    [
      "duplicate capability",
      {
        id: "openai-compatible",
        model: "test",
        endpoint: "https://models.example/v1",
        capabilities: ["text-streaming", "text-streaming"],
      },
      "invalid-capabilities",
    ],
  ] as const)("rejects %s", (_name, values, code) => {
    expect(() => readProviderConfiguration(configuration(values))).toThrowError(
      expect.objectContaining({ code }),
    );
  });

  it("reports safe errors without echoing rejected input", () => {
    const rejectedEndpoint = "http://user:secret@remote.example.test/v1";
    const error = (() => {
      try {
        readProviderConfiguration(
          configuration({ id: "openai-compatible", model: "test", endpoint: rejectedEndpoint }),
        );
      } catch (failure) {
        return failure;
      }
    })();

    expect(error).toBeInstanceOf(ProviderConfigurationError);
    expect(String(error)).not.toContain(rejectedEndpoint);
    expect(String(error)).not.toContain("secret");
  });
});
