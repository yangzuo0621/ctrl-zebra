import { describe, expect, it, vi } from "vitest";

import type { ProviderApiKeySecretReader } from "../adapters/api-key-secret-storage.js";
import type { ProviderConfiguration, ProviderId } from "../adapters/provider-configuration.js";
import {
  checkProviderConnection,
  checkProviderConnectionCommandId,
  type ProviderConnectionCheckReport,
  registerProviderConnectionCheckCommand,
} from "./provider-connection-check-command.js";

describe("Provider connection check", () => {
  it.each([
    {
      provider: "openai" as const,
      configuration: openAIConfiguration(),
      body: { id: "gpt-test" },
      expectedUrl: "https://api.openai.com/v1/models/gpt-test",
      expectedHeaders: { Accept: "application/json", Authorization: "Bearer test-openai-key" },
    },
    {
      provider: "gemini" as const,
      configuration: geminiConfiguration(),
      body: {
        name: "models/gemini-test",
        supportedGenerationMethods: ["streamGenerateContent"],
      },
      expectedUrl: "https://generativelanguage.googleapis.com/v1beta/models/gemini-test",
      expectedHeaders: { Accept: "application/json", "x-goog-api-key": "test-gemini-key" },
    },
    {
      provider: "openai-compatible" as const,
      configuration: compatibleConfiguration(),
      body: { id: "compatible-test" },
      expectedUrl: "https://models.example.test/v1/models/compatible-test",
      expectedHeaders: { Accept: "application/json", Authorization: "Bearer test-compatible-key" },
    },
  ])("checks the $provider metadata route without model context", async ({
    configuration,
    body,
    expectedUrl,
    expectedHeaders,
    provider,
  }) => {
    const configurationBefore = structuredClone(configuration);
    const fetch = createFetch(jsonResponse(body));
    const secrets = createSecrets({
      openai: "test-openai-key",
      gemini: "test-gemini-key",
      "openai-compatible": "test-compatible-key",
    });

    const report = await checkProviderConnection({
      configuration,
      secrets,
      fetch,
      signal: new AbortController().signal,
    });

    expect(report).toMatchObject({
      provider,
      modelId: configuration.modelId,
      authentication: "supported",
      modelExistence: "supported",
      outcome: "completed",
    });
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe(expectedUrl);
    expect(init).toMatchObject({
      method: "GET",
      headers: expectedHeaders,
      redirect: "error",
    });
    expect(init).not.toHaveProperty("body");
    expect(secrets.read).toHaveBeenCalledWith(provider);
    expect(configuration).toEqual(configurationBefore);
  });

  it("reports Gemini streaming support only from the documented complete method list", async () => {
    const configuration = geminiConfiguration();
    const fetch = createFetch(
      jsonResponse({ name: "models/gemini-test", supportedGenerationMethods: ["generateContent"] }),
    );

    const report = await checkProviderConnection({
      configuration,
      secrets: createSecrets({ gemini: "test-gemini-key" }),
      fetch,
      signal: new AbortController().signal,
    });

    expect(report.capabilities).toEqual({
      textStreaming: "unsupported",
      toolCalling: "unknown",
      required: "unsupported",
    });
  });

  it.each([
    undefined,
    7,
    ["generateContent", 7],
  ])("keeps Gemini capability facts unknown when metadata is not a valid method list (%s)", async (methods) => {
    const fetch = createFetch(
      jsonResponse({ name: "models/gemini-test", supportedGenerationMethods: methods }),
    );

    const report = await checkProviderConnection({
      configuration: geminiConfiguration(),
      secrets: createSecrets({ gemini: "test-gemini-key" }),
      fetch,
      signal: new AbortController().signal,
    });

    expect(report.capabilities).toEqual({
      textStreaming: "unknown",
      toolCalling: "unknown",
      required: "unknown",
    });
  });

  it("never infers OpenAI capabilities from a successful model response", async () => {
    const report = await checkProviderConnection({
      configuration: openAIConfiguration(),
      secrets: createSecrets({ openai: "test-openai-key" }),
      fetch: createFetch(jsonResponse({ id: "gpt-test", tool_calling: true, streaming: true })),
      signal: new AbortController().signal,
    });

    expect(report.capabilities).toEqual({
      textStreaming: "unknown",
      toolCalling: "unknown",
      required: "unknown",
    });
  });

  it("uses the exact compatible model path and omits auth for a loopback endpoint without a key", async () => {
    const fetch = createFetch(jsonResponse({ id: "compatible-test" }));
    const secrets = createSecrets({ "openai-compatible": undefined });

    const report = await checkProviderConnection({
      configuration: compatibleConfiguration("http://127.0.0.1:11434/v1"),
      secrets,
      fetch,
      signal: new AbortController().signal,
    });

    expect(report.authentication).toBe("supported");
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("http://127.0.0.1:11434/v1/models/compatible-test");
    expect(init?.headers).toEqual({ Accept: "application/json" });
    expect(JSON.stringify(init)).not.toContain("Authorization");
  });

  it("rejects an untrusted compatible endpoint shape before reading a key", async () => {
    const fetch = createFetch(jsonResponse({ id: "compatible-test" }));
    const secrets = createSecrets({ "openai-compatible": "test-key" });
    const configuration = {
      ...compatibleConfiguration("http://not-loopback.example.test/v1"),
      requiresApiKey: true,
    };

    const report = await checkProviderConnection({
      configuration,
      secrets,
      fetch,
      signal: new AbortController().signal,
    });

    expect(report).toMatchObject({ outcome: "failed", errorCode: "configuration" });
    expect(secrets.read).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("encodes the configured model as exactly one path segment", async () => {
    const fetch = createFetch(jsonResponse({ id: "model/with%value" }));
    const configuration = compatibleConfiguration(
      "https://models.example.test/v1",
      "model/with%value",
    );

    await checkProviderConnection({
      configuration,
      secrets: createSecrets({ "openai-compatible": "test-key" }),
      fetch,
      signal: new AbortController().signal,
    });

    expect(fetch.mock.calls[0]?.[0]).toBe(
      "https://models.example.test/v1/models/model%2Fwith%25value",
    );
  });

  it.each([
    ["openai", openAIConfiguration(), "openai"],
    ["gemini", geminiConfiguration(), "gemini"],
  ] as const)("does not probe a dedicated Provider custom endpoint", async (_name, configuration, provider) => {
    const fetch = createFetch(jsonResponse({ id: configuration.modelId }));
    const secrets = createSecrets({ [provider]: "test-key" } as Partial<
      Record<ProviderId, string>
    >);

    const report = await checkProviderConnection({
      configuration: { ...configuration, endpoint: "https://custom.example.test/v1" },
      secrets,
      fetch,
      signal: new AbortController().signal,
    });

    expect(report).toMatchObject({
      authentication: "unknown",
      modelExistence: "unknown",
      capabilities: {
        textStreaming: "unknown",
        toolCalling: "unknown",
        required: "unknown",
      },
      outcome: "completed",
      errorCode: "unknown",
      guidance: "provider-documentation",
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(secrets.read).not.toHaveBeenCalled();
  });

  it("maps a missing required key to authentication failure without contacting the endpoint", async () => {
    const fetch = createFetch(jsonResponse({ id: "gpt-test" }));
    const report = await checkProviderConnection({
      configuration: openAIConfiguration(),
      secrets: createSecrets({ openai: undefined }),
      fetch,
      signal: new AbortController().signal,
    });

    expect(report).toMatchObject({
      authentication: "unsupported",
      modelExistence: "unknown",
      outcome: "failed",
      errorCode: "authentication",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    [401, "authentication", "unsupported", "unknown"],
    [403, "authentication", "unsupported", "unknown"],
    [404, "model-not-found", "unknown", "unsupported"],
    [429, "rate-limit", "unknown", "unknown"],
  ] as const)("classifies HTTP %s using status only", async (status, errorCode, authentication, modelExistence) => {
    const fetch = createFetch(new Response("sensitive provider body", { status }));
    const report = await checkProviderConnection({
      configuration: openAIConfiguration(),
      secrets: createSecrets({ openai: "test-key" }),
      fetch,
      signal: new AbortController().signal,
    });

    expect(report).toMatchObject({
      authentication,
      modelExistence,
      outcome: "failed",
      errorCode,
    });
  });

  it("rejects an unusable response without exposing its contents", async () => {
    const secret = "sk-test-sensitive-response-value";
    const fetch = createFetch(new Response(JSON.stringify({ id: secret }), { status: 200 }));
    const report = await checkProviderConnection({
      configuration: openAIConfiguration(),
      secrets: createSecrets({ openai: "test-api-key" }),
      fetch,
      signal: new AbortController().signal,
    });

    expect(report.errorCode).toBe("malformed");
    expect(JSON.stringify(report)).not.toContain(secret);
  });

  it("rejects a response larger than the body limit", async () => {
    const fetch = createFetch(new Response(new Uint8Array(64 * 1024 + 1), { status: 200 }));

    const report = await checkProviderConnection({
      configuration: openAIConfiguration(),
      secrets: createSecrets({ openai: "test-key" }),
      fetch,
      signal: new AbortController().signal,
    });

    expect(report.errorCode).toBe("malformed");
  });

  it("keeps cancellation distinct and performs no request when cancelled first", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetch = createFetch(jsonResponse({ id: "gpt-test" }));
    const secrets = createSecrets({ openai: "test-key" });

    const report = await checkProviderConnection({
      configuration: openAIConfiguration(),
      secrets,
      fetch,
      signal: controller.signal,
    });

    expect(report).toMatchObject({ outcome: "cancelled", errorCode: "cancelled" });
    expect(fetch).not.toHaveBeenCalled();
    expect(secrets.read).not.toHaveBeenCalled();
  });

  it("cancels an in-flight request without reporting a late success", async () => {
    const controller = new AbortController();
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
      await new Promise<never>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      });
      throw new Error("unreachable");
    });
    const pending = checkProviderConnection({
      configuration: openAIConfiguration(),
      secrets: createSecrets({ openai: "test-key" }),
      fetch,
      signal: controller.signal,
    });

    await waitFor(() => fetch.mock.calls.length === 1);
    controller.abort();
    await expect(pending).resolves.toMatchObject({ outcome: "cancelled", errorCode: "cancelled" });
  });

  it("maps an operation timeout separately from network failure", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() => new Promise<Response>(() => undefined));

    const report = await checkProviderConnection({
      configuration: openAIConfiguration(),
      secrets: createSecrets({ openai: "test-key" }),
      fetch,
      signal: new AbortController().signal,
      timeoutMs: 1,
    });

    expect(report).toMatchObject({ outcome: "failed", errorCode: "timeout" });
  });

  it("bounds a hung SecretStorage read with the operation deadline", async () => {
    const controller = new AbortController();
    const read = vi.fn(() => new Promise<string | undefined>(() => undefined));
    const fetch = createFetch(jsonResponse({ id: "gpt-test" }));

    const report = await checkProviderConnection({
      configuration: openAIConfiguration(),
      secrets: { read },
      fetch,
      signal: controller.signal,
      timeoutMs: 1,
    });

    expect(report).toMatchObject({ outcome: "failed", errorCode: "timeout" });
    expect(read).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();

    controller.abort();
    await Promise.resolve();
    expect(report).toMatchObject({ outcome: "failed", errorCode: "timeout" });
  });

  it("gives dedicated custom endpoints fixed service-documentation guidance", async () => {
    const handlers = new Map<string, () => Promise<ProviderConnectionCheckReport | undefined>>();
    const showInformationMessage = vi.fn(async (_message: string) => undefined);
    const showErrorMessage = vi.fn(async (_message: string) => undefined);
    const fetch = createFetch(jsonResponse({ id: "gpt-test" }));
    const customEndpoint = "https://custom.example.test/v1?secret=must-not-display";

    const disposable = registerProviderConnectionCheckCommand({
      registerCommand: vi.fn((commandId, handler) => {
        handlers.set(commandId, handler);
        return { dispose: vi.fn() };
      }),
      readConfiguration: () => openAIConfiguration(customEndpoint),
      secrets: createSecrets({ openai: "test-key" }),
      fetch,
      runWithProgress: async (task) => task(createCancellationToken()),
      showInformationMessage,
      showErrorMessage,
    });

    const report = await handlers.get(checkProviderConnectionCommandId)?.();
    const message = showInformationMessage.mock.calls[0]?.[0] ?? "";
    expect(report).toMatchObject({ outcome: "completed", guidance: "provider-documentation" });
    expect(showInformationMessage).toHaveBeenCalledWith(
      "OpenAI connection check for model gpt-test: Authentication unknown; Model unknown; Streaming unknown; Tool Calling unknown; Required capabilities unknown. The configured dedicated Provider endpoint was not probed. Check the OpenAI service documentation for its model metadata route and authentication.",
    );
    expect(message).not.toContain(customEndpoint);
    expect(message).not.toContain("secret=must-not-display");
    expect(fetch).not.toHaveBeenCalled();

    disposable.dispose();
  });

  it("registers a discoverable cancellable command and redacts raw failures", async () => {
    const handlers = new Map<string, () => Promise<ProviderConnectionCheckReport | undefined>>();
    const registration = { dispose: vi.fn() };
    const showInformationMessage = vi.fn(async (_message: string) => undefined);
    const showErrorMessage = vi.fn(async (_message: string) => undefined);
    const log = vi.fn();
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      throw new Error("Bearer sk-test-sensitive raw provider body");
    });
    const token = createCancellationToken();

    const disposable = registerProviderConnectionCheckCommand({
      registerCommand: vi.fn((commandId, handler) => {
        handlers.set(commandId, handler);
        return registration;
      }),
      readConfiguration: () => openAIConfiguration(),
      secrets: createSecrets({ openai: "test-key" }),
      fetch,
      runWithProgress: async (task) => task(token),
      showInformationMessage,
      showErrorMessage,
      now: () => 10,
      log,
    });

    const report = await handlers.get(checkProviderConnectionCommandId)?.();
    expect(report?.errorCode).toBe("network");
    expect(showErrorMessage).toHaveBeenCalledWith(
      "Unable to reach OpenAI. Check the endpoint and try again.",
    );
    expect(String(showErrorMessage.mock.calls)).not.toContain("sk-test-sensitive");
    expect(String(log.mock.calls)).not.toContain("sk-test-sensitive");
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "failure", provider: "openai" }),
    );

    disposable.dispose();
    expect(registration.dispose).toHaveBeenCalledOnce();
  });
});

function openAIConfiguration(endpoint?: string): ProviderConfiguration {
  return {
    version: 1,
    provider: "openai",
    modelId: "gpt-test",
    endpoint,
    capabilities: ["text-streaming", "tool-calling"],
  };
}

function geminiConfiguration(endpoint?: string): ProviderConfiguration {
  return {
    version: 1,
    provider: "gemini",
    modelId: "gemini-test",
    endpoint,
    capabilities: ["text-streaming", "tool-calling"],
  };
}

function compatibleConfiguration(
  endpoint = "https://models.example.test/v1",
  modelId = "compatible-test",
): ProviderConfiguration {
  return {
    version: 1,
    provider: "openai-compatible",
    modelId,
    endpoint,
    capabilities: ["text-streaming"],
    requiresApiKey: !endpoint.startsWith("http://127.") && !endpoint.startsWith("http://localhost"),
  };
}

function createSecrets(values: Partial<Record<ProviderId, string>>): ProviderApiKeySecretReader & {
  readonly read: ReturnType<typeof vi.fn>;
} {
  const read = vi.fn(async (provider: ProviderId) => values[provider]);
  return { read };
}

function createFetch(response: Response): ReturnType<typeof vi.fn<typeof globalThis.fetch>> {
  return vi.fn<typeof globalThis.fetch>(async () => response.clone());
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function createCancellationToken(): {
  readonly isCancellationRequested: false;
  readonly onCancellationRequested: () => { dispose(): void };
} {
  return {
    isCancellationRequested: false,
    onCancellationRequested: () => ({ dispose: vi.fn() }),
  };
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20 && !condition(); attempt += 1) {
    await Promise.resolve();
  }
}
