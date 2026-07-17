import type { SecretStorage } from "vscode";

import type { ProviderId } from "./provider-configuration.js";

export const openAIApiKeySecretName = "ctrlZebra.provider.openai.apiKey";
export const geminiApiKeySecretName = "ctrlZebra.provider.gemini.apiKey";
export const openAICompatibleApiKeySecretName = "ctrlZebra.provider.openaiCompatible.apiKey";

export const apiKeySecretNames = {
  openai: openAIApiKeySecretName,
  gemini: geminiApiKeySecretName,
  "openai-compatible": openAICompatibleApiKeySecretName,
} as const satisfies Record<ProviderId, string>;

export type ApiKeySecretStorageOperation = "read" | "save" | "delete";

export interface ApiKeySecretStorage {
  read(): Promise<string | undefined>;
  save(apiKey: string): Promise<void>;
  delete(): Promise<void>;
}

export interface ProviderApiKeySecretReader {
  read(provider: ProviderId): Promise<string | undefined>;
}

type SecretStorageBackend = Pick<SecretStorage, "get" | "store" | "delete">;

export class ApiKeySecretStorageError extends Error {
  readonly operation: ApiKeySecretStorageOperation;

  constructor(operation: ApiKeySecretStorageOperation) {
    super(errorMessageByOperation[operation]);
    this.name = "ApiKeySecretStorageError";
    this.operation = operation;
  }
}

const errorMessageByOperation = {
  read: "Unable to read the saved API key.",
  save: "Unable to save the API key.",
  delete: "Unable to delete the saved API key.",
} satisfies Record<ApiKeySecretStorageOperation, string>;

export function createOpenAIApiKeySecretStorage(
  secretStorage: SecretStorageBackend,
): ApiKeySecretStorage {
  return createApiKeySecretStorage(secretStorage, openAIApiKeySecretName);
}

export function createGeminiApiKeySecretStorage(
  secretStorage: SecretStorageBackend,
): ApiKeySecretStorage {
  return createApiKeySecretStorage(secretStorage, geminiApiKeySecretName);
}

function createApiKeySecretStorage(
  secretStorage: SecretStorageBackend,
  secretName: string,
): ApiKeySecretStorage {
  return {
    async read() {
      try {
        return await secretStorage.get(secretName);
      } catch {
        throw new ApiKeySecretStorageError("read");
      }
    },
    async save(apiKey) {
      try {
        await secretStorage.store(secretName, apiKey);
      } catch {
        throw new ApiKeySecretStorageError("save");
      }
    },
    async delete() {
      try {
        await secretStorage.delete(secretName);
      } catch {
        throw new ApiKeySecretStorageError("delete");
      }
    },
  };
}

export function createProviderApiKeySecretReader(
  secretStorage: Pick<SecretStorageBackend, "get">,
): ProviderApiKeySecretReader {
  return {
    async read(provider) {
      try {
        return await secretStorage.get(apiKeySecretNames[provider]);
      } catch {
        throw new ApiKeySecretStorageError("read");
      }
    },
  };
}
