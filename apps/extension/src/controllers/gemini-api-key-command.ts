import type { Disposable, InputBoxOptions } from "vscode";

import {
  type ApiKeySecretStorage,
  ApiKeySecretStorageError,
} from "../adapters/api-key-secret-storage.js";

export const saveGeminiApiKeyCommandId = "ctrlZebra.saveGeminiApiKey";

interface RegisterGeminiApiKeyCommandOptions {
  readonly storage: ApiKeySecretStorage;
  readonly registerCommand: (commandId: string, handler: () => Promise<void>) => Disposable;
  readonly showInputBox: (options: InputBoxOptions) => Thenable<string | undefined>;
  readonly showInformationMessage: (message: string) => Thenable<unknown>;
  readonly showErrorMessage: (message: string) => Thenable<unknown>;
}

export function registerGeminiApiKeyCommand({
  storage,
  registerCommand,
  showInputBox,
  showInformationMessage,
  showErrorMessage,
}: RegisterGeminiApiKeyCommandOptions): Disposable {
  return registerCommand(saveGeminiApiKeyCommandId, async () => {
    const apiKey = await showInputBox({
      ignoreFocusOut: true,
      password: true,
      prompt: "Enter the Google Gemini API key to store securely on this machine.",
      title: "CtrlZebra: Save Gemini API Key",
      validateInput: validateGeminiApiKey,
    });

    if (apiKey === undefined) {
      return;
    }

    if (validateGeminiApiKey(apiKey) !== undefined) {
      await showErrorMessage("Enter a non-empty Gemini API key.");
      return;
    }

    try {
      await storage.save(apiKey);
    } catch (error) {
      if (error instanceof ApiKeySecretStorageError) {
        await showErrorMessage(error.message);
        return;
      }

      throw error;
    }

    await showInformationMessage("Gemini API key saved securely.");
  });
}

function validateGeminiApiKey(value: string): string | undefined {
  return value.length === 0 ? "Enter a non-empty Gemini API key." : undefined;
}
