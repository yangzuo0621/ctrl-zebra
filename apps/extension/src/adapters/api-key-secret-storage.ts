import type { SecretStorage } from "vscode";

export const openAIApiKeySecretName = "ctrlZebra.provider.openai.apiKey";

export type ApiKeySecretStorageOperation = "read" | "save" | "delete";

export interface ApiKeySecretStorage {
  read(): Promise<string | undefined>;
  save(apiKey: string): Promise<void>;
  delete(): Promise<void>;
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
  return {
    async read() {
      try {
        return await secretStorage.get(openAIApiKeySecretName);
      } catch {
        throw new ApiKeySecretStorageError("read");
      }
    },
    async save(apiKey) {
      try {
        await secretStorage.store(openAIApiKeySecretName, apiKey);
      } catch {
        throw new ApiKeySecretStorageError("save");
      }
    },
    async delete() {
      try {
        await secretStorage.delete(openAIApiKeySecretName);
      } catch {
        throw new ApiKeySecretStorageError("delete");
      }
    },
  };
}
