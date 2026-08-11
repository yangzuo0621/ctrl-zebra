import type { Disposable, InputBoxOptions, MessageOptions } from "vscode";

import {
  type ApiKeySecretStorage,
  ApiKeySecretStorageError,
} from "../adapters/api-key-secret-storage.js";
import type { ProviderId } from "../adapters/provider-configuration.js";

export const saveOpenAIApiKeyCommandId = "ctrlZebra.saveOpenAIApiKey";
export const saveGeminiApiKeyCommandId = "ctrlZebra.saveGeminiApiKey";
export const saveOpenAICompatibleApiKeyCommandId = "ctrlZebra.saveOpenAICompatibleApiKey";

const confirmSaveAction = "Replace";

interface ProviderApiKeyCommandDefinition {
  readonly provider: ProviderId;
  readonly commandId: string;
  readonly providerLabel: string;
  readonly inputProviderLabel: string;
}

export const providerApiKeyCommandDefinitions = [
  {
    provider: "openai",
    commandId: saveOpenAIApiKeyCommandId,
    providerLabel: "OpenAI",
    inputProviderLabel: "OpenAI",
  },
  {
    provider: "gemini",
    commandId: saveGeminiApiKeyCommandId,
    providerLabel: "Gemini",
    inputProviderLabel: "Google Gemini",
  },
  {
    provider: "openai-compatible",
    commandId: saveOpenAICompatibleApiKeyCommandId,
    providerLabel: "OpenAI-Compatible",
    inputProviderLabel: "OpenAI-Compatible",
  },
] as const satisfies readonly ProviderApiKeyCommandDefinition[];

export interface RegisterProviderApiKeyCommandsOptions {
  readonly storages: Readonly<Record<ProviderId, ApiKeySecretStorage>>;
  readonly registerCommand: (commandId: string, handler: () => Promise<void>) => Disposable;
  readonly showInputBox: (options: InputBoxOptions) => Thenable<string | undefined>;
  readonly showWarningMessage: (
    message: string,
    options: MessageOptions,
    ...items: [typeof confirmSaveAction]
  ) => Thenable<typeof confirmSaveAction | undefined>;
  readonly showInformationMessage: (message: string) => Thenable<unknown>;
  readonly showErrorMessage: (message: string) => Thenable<unknown>;
}

export type RegisterProviderApiKeyCommandOptions = Omit<
  RegisterProviderApiKeyCommandsOptions,
  "storages"
> & {
  readonly storage: ApiKeySecretStorage;
};

export function registerProviderApiKeyCommand(
  provider: ProviderId,
  {
    storage,
    registerCommand,
    showInputBox,
    showWarningMessage,
    showInformationMessage,
    showErrorMessage,
  }: RegisterProviderApiKeyCommandOptions,
): Disposable {
  const definition = providerApiKeyCommandDefinitions.find(
    (candidate) => candidate.provider === provider,
  );
  if (definition === undefined) {
    throw new Error(`Unsupported provider API key command: ${provider}`);
  }

  return registerCommand(definition.commandId, async () => {
    await saveProviderApiKey({
      definition,
      storage,
      showInputBox,
      showWarningMessage,
      showInformationMessage,
      showErrorMessage,
    });
  });
}

export function registerProviderApiKeyCommands({
  storages,
  registerCommand,
  showInputBox,
  showWarningMessage,
  showInformationMessage,
  showErrorMessage,
}: RegisterProviderApiKeyCommandsOptions): Disposable {
  const registrations = providerApiKeyCommandDefinitions.map(({ provider }) =>
    registerProviderApiKeyCommand(provider, {
      storage: storages[provider],
      registerCommand,
      showInputBox,
      showWarningMessage,
      showInformationMessage,
      showErrorMessage,
    }),
  );

  return {
    dispose() {
      for (const registration of registrations) {
        registration.dispose();
      }
    },
  };
}

interface SaveProviderApiKeyOptions {
  readonly definition: ProviderApiKeyCommandDefinition;
  readonly storage: ApiKeySecretStorage;
  readonly showInputBox: (options: InputBoxOptions) => Thenable<string | undefined>;
  readonly showWarningMessage: RegisterProviderApiKeyCommandsOptions["showWarningMessage"];
  readonly showInformationMessage: (message: string) => Thenable<unknown>;
  readonly showErrorMessage: (message: string) => Thenable<unknown>;
}

async function saveProviderApiKey({
  definition,
  storage,
  showInputBox,
  showWarningMessage,
  showInformationMessage,
  showErrorMessage,
}: SaveProviderApiKeyOptions): Promise<void> {
  const apiKey = await showInputBox({
    ignoreFocusOut: true,
    password: true,
    prompt: `Enter the ${definition.inputProviderLabel} API key to store securely on this machine.`,
    title: `CtrlZebra: Save ${definition.providerLabel} API Key`,
    validateInput: (value) => validateApiKey(value, definition.providerLabel),
  });

  if (apiKey === undefined) {
    return;
  }

  const validationMessage = validateApiKey(apiKey, definition.providerLabel);
  if (validationMessage !== undefined) {
    await showErrorMessage(validationMessage);
    return;
  }

  const confirmation = await showWarningMessage(
    "Saving this key will replace any saved key for this provider. Continue?",
    { modal: true },
    confirmSaveAction,
  );
  if (confirmation !== confirmSaveAction) {
    return;
  }

  try {
    await storage.save(apiKey);
  } catch (error) {
    if (error instanceof ApiKeySecretStorageError) {
      await showErrorMessage(error.message);
      return;
    }

    // Storage backends are untrusted host boundaries; never surface their error text because it
    // could contain the submitted credential or backend details.
    await showErrorMessage("Unable to save the API key.");
    return;
  }

  await showInformationMessage(`${definition.providerLabel} API key saved securely.`);
}

function validateApiKey(value: string, providerLabel: string): string | undefined {
  return value.length === 0 ? `Enter a non-empty ${providerLabel} API key.` : undefined;
}
