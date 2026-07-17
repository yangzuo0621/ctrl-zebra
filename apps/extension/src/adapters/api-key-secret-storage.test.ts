import { describe, expect, it } from "vitest";

import {
  ApiKeySecretStorageError,
  type ApiKeySecretStorageOperation,
  apiKeySecretNames,
  createOpenAIApiKeySecretStorage,
  createProviderApiKeySecretReader,
  openAIApiKeySecretName,
} from "./api-key-secret-storage.js";

class InMemorySecretStorage {
  readonly values = new Map<string, string>();
  failure: ApiKeySecretStorageOperation | undefined;

  async get(key: string): Promise<string | undefined> {
    this.throwWhenFailed("read");
    return this.values.get(key);
  }

  async store(key: string, value: string): Promise<void> {
    this.throwWhenFailed("save");
    this.values.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.throwWhenFailed("delete");
    this.values.delete(key);
  }

  private throwWhenFailed(operation: ApiKeySecretStorageOperation): void {
    if (this.failure === operation) {
      throw new Error("test-openai-api-key must not escape through this failure");
    }
  }
}

describe("OpenAI API key SecretStorage adapter", () => {
  it("stores, reads, and replaces the API key under the stable secret name", async () => {
    const backend = new InMemorySecretStorage();
    const storage = createOpenAIApiKeySecretStorage(backend);

    await storage.save("test-openai-api-key");
    expect(await storage.read()).toBe("test-openai-api-key");
    expect(backend.values).toEqual(new Map([[openAIApiKeySecretName, "test-openai-api-key"]]));

    await storage.save("test-openai-api-key-replacement");
    expect(await storage.read()).toBe("test-openai-api-key-replacement");
    expect(backend.values).toHaveLength(1);
  });

  it("returns undefined when the API key is absent", async () => {
    const storage = createOpenAIApiKeySecretStorage(new InMemorySecretStorage());

    await expect(storage.read()).resolves.toBeUndefined();
  });

  it("deletes the API key and treats repeated deletion as success", async () => {
    const storage = createOpenAIApiKeySecretStorage(new InMemorySecretStorage());

    await storage.save("test-openai-api-key");
    await storage.delete();
    await storage.delete();

    await expect(storage.read()).resolves.toBeUndefined();
  });

  it.each([
    "read",
    "save",
    "delete",
  ] as const)("maps a %s failure without exposing the backend error", async (operation) => {
    const backend = new InMemorySecretStorage();
    backend.failure = operation;
    const storage = createOpenAIApiKeySecretStorage(backend);

    const result =
      operation === "read"
        ? storage.read()
        : operation === "save"
          ? storage.save("test-openai-api-key")
          : storage.delete();

    const error = await result.catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(ApiKeySecretStorageError);
    expect(error).toMatchObject({ operation });
    expect(String(error)).not.toContain("test-openai-api-key");
  });
});

describe("Provider API key SecretStorage reader", () => {
  it.each([
    ["openai", "test-openai-api-key"],
    ["gemini", "test-gemini-api-key"],
    ["openai-compatible", "test-compatible-api-key"],
  ] as const)("reads the %s API key from its Extension-owned name", async (provider, apiKey) => {
    const backend = new InMemorySecretStorage();
    backend.values.set(apiKeySecretNames[provider], apiKey);

    await expect(createProviderApiKeySecretReader(backend).read(provider)).resolves.toBe(apiKey);
  });

  it("maps read failures without exposing the backend error", async () => {
    const backend = new InMemorySecretStorage();
    backend.failure = "read";

    const error = await createProviderApiKeySecretReader(backend)
      .read("gemini")
      .catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(ApiKeySecretStorageError);
    expect(String(error)).not.toContain("test-openai-api-key");
  });
});
