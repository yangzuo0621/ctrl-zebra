import type { Disposable, InputBoxOptions, MessageOptions } from "vscode";

import type { ApiKeySecretStorage } from "../adapters/api-key-secret-storage.js";
import {
  registerProviderApiKeyCommand,
  saveGeminiApiKeyCommandId,
} from "./provider-api-key-command.js";

export { saveGeminiApiKeyCommandId } from "./provider-api-key-command.js";

interface RegisterGeminiApiKeyCommandOptions {
  readonly storage: ApiKeySecretStorage;
  readonly registerCommand: (commandId: string, handler: () => Promise<void>) => Disposable;
  readonly showInputBox: (options: InputBoxOptions) => Thenable<string | undefined>;
  readonly showInformationMessage: (message: string) => Thenable<unknown>;
  readonly showErrorMessage: (message: string) => Thenable<unknown>;
  readonly showWarningMessage?: (
    message: string,
    options: MessageOptions,
    item: "Replace",
  ) => Thenable<"Replace" | undefined>;
}

/**
 * Backward-compatible single-provider registration kept for extensions that imported the original
 * Gemini-only controller. New composition should register all providers through the parameterized
 * provider command controller.
 */
export function registerGeminiApiKeyCommand({
  storage,
  registerCommand,
  showInputBox,
  showInformationMessage,
  showErrorMessage,
  showWarningMessage = async () => "Replace",
}: RegisterGeminiApiKeyCommandOptions): Disposable {
  return registerProviderApiKeyCommand("gemini", {
    storage,
    registerCommand: (commandId, handler) => {
      if (commandId !== saveGeminiApiKeyCommandId) {
        throw new Error(`Unexpected command registration: ${commandId}`);
      }
      return registerCommand(commandId, handler);
    },
    showInputBox,
    showWarningMessage,
    showInformationMessage,
    showErrorMessage,
  });
}
