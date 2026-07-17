import { describe, expect, it } from "vitest";

import {
  type ConfigurationReader,
  ProviderConfigurationError,
  readProviderConfiguration,
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

  it.each([
    ["https://models.example.test/v1", true],
    ["http://localhost:11434/v1", false],
    ["http://127.24.0.1:11434/v1", false],
    ["http://[::1]:11434/v1", false],
  ] as const)("accepts an OpenAI-Compatible endpoint %s", (endpoint, requiresApiKey) => {
    expect(
      readProviderConfiguration(
        configuration({
          id: "openai-compatible",
          model: "compatible-test-model",
          endpoint,
          capabilities: ["text-streaming"],
        }),
      ),
    ).toEqual({
      version: 1,
      provider: "openai-compatible",
      modelId: "compatible-test-model",
      endpoint,
      capabilities: ["text-streaming"],
      requiresApiKey,
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
      "remote HTTP endpoint",
      { id: "openai-compatible", model: "test", endpoint: "http://models.example.test/v1" },
      "invalid-endpoint",
    ],
    [
      "loopback lookalike",
      { id: "openai-compatible", model: "test", endpoint: "http://localhost.example.test/v1" },
      "invalid-endpoint",
    ],
    [
      "credential-bearing endpoint",
      { id: "openai-compatible", model: "test", endpoint: "https://user@models.example/v1" },
      "invalid-endpoint",
    ],
    [
      "endpoint with query",
      { id: "openai-compatible", model: "test", endpoint: "https://models.example/v1?key=x" },
      "invalid-endpoint",
    ],
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
