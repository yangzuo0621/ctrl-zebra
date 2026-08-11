import type { Disposable, InputBoxOptions, MessageOptions } from "vscode";

import type {
  ApiKeySecretStorage,
  ProviderApiKeyPresence,
  ProviderApiKeyPresenceReader,
} from "../adapters/api-key-secret-storage.js";
import type { ProviderId } from "../adapters/provider-configuration.js";
import type { ProviderOnboardingActionResult } from "./provider-onboarding-controller.js";

export const saveOpenAIApiKeyCommandId = "ctrlZebra.saveOpenAIApiKey";
export const saveGeminiApiKeyCommandId = "ctrlZebra.saveGeminiApiKey";
export const saveOpenAICompatibleApiKeyCommandId = "ctrlZebra.saveOpenAICompatibleApiKey";
export const rotateOpenAIApiKeyCommandId = "ctrlZebra.rotateOpenAIApiKey";
export const rotateGeminiApiKeyCommandId = "ctrlZebra.rotateGeminiApiKey";
export const rotateOpenAICompatibleApiKeyCommandId = "ctrlZebra.rotateOpenAICompatibleApiKey";
export const deleteOpenAIApiKeyCommandId = "ctrlZebra.deleteOpenAIApiKey";
export const deleteGeminiApiKeyCommandId = "ctrlZebra.deleteGeminiApiKey";
export const deleteOpenAICompatibleApiKeyCommandId = "ctrlZebra.deleteOpenAICompatibleApiKey";

const confirmSaveAction = "Replace";
const confirmDeleteAction = "Delete";

type ProviderApiKeyCommandOperation = "save" | "rotate" | "delete";

interface ProviderApiKeyCommandDefinition {
  readonly provider: ProviderId;
  readonly commandId: string;
  readonly providerLabel: string;
  readonly inputProviderLabel: string;
  readonly operation: ProviderApiKeyCommandOperation;
}

export const providerApiKeyCommandDefinitions = [
  {
    provider: "openai",
    commandId: saveOpenAIApiKeyCommandId,
    providerLabel: "OpenAI",
    inputProviderLabel: "OpenAI",
    operation: "save",
  },
  {
    provider: "gemini",
    commandId: saveGeminiApiKeyCommandId,
    providerLabel: "Gemini",
    inputProviderLabel: "Google Gemini",
    operation: "save",
  },
  {
    provider: "openai-compatible",
    commandId: saveOpenAICompatibleApiKeyCommandId,
    providerLabel: "OpenAI-Compatible",
    inputProviderLabel: "OpenAI-Compatible",
    operation: "save",
  },
] as const satisfies readonly ProviderApiKeyCommandDefinition[];

export const providerApiKeyLifecycleCommandDefinitions = [
  ...providerApiKeyCommandDefinitions,
  {
    provider: "openai",
    commandId: rotateOpenAIApiKeyCommandId,
    providerLabel: "OpenAI",
    inputProviderLabel: "OpenAI",
    operation: "rotate",
  },
  {
    provider: "gemini",
    commandId: rotateGeminiApiKeyCommandId,
    providerLabel: "Gemini",
    inputProviderLabel: "Google Gemini",
    operation: "rotate",
  },
  {
    provider: "openai-compatible",
    commandId: rotateOpenAICompatibleApiKeyCommandId,
    providerLabel: "OpenAI-Compatible",
    inputProviderLabel: "OpenAI-Compatible",
    operation: "rotate",
  },
  {
    provider: "openai",
    commandId: deleteOpenAIApiKeyCommandId,
    providerLabel: "OpenAI",
    inputProviderLabel: "OpenAI",
    operation: "delete",
  },
  {
    provider: "gemini",
    commandId: deleteGeminiApiKeyCommandId,
    providerLabel: "Gemini",
    inputProviderLabel: "Google Gemini",
    operation: "delete",
  },
  {
    provider: "openai-compatible",
    commandId: deleteOpenAICompatibleApiKeyCommandId,
    providerLabel: "OpenAI-Compatible",
    inputProviderLabel: "OpenAI-Compatible",
    operation: "delete",
  },
] as const satisfies readonly ProviderApiKeyCommandDefinition[];

export interface ProviderApiKeyOperationContext {
  readonly isCurrent: () => boolean;
}

/** Serializes credential operations per Provider without retaining credential material. */
export class ProviderApiKeyOperationCoordinator {
  readonly #tails = new Map<ProviderId, Promise<void>>();
  #generation = 0;
  #disposed = false;

  run<T>(
    provider: ProviderId,
    operation: (context: ProviderApiKeyOperationContext) => Promise<T>,
  ): Promise<T | undefined> {
    const generation = this.#generation;
    const previous = this.#tails.get(provider) ?? Promise.resolve();
    const current = previous
      .catch(() => undefined)
      .then(async () => {
        if (!this.isCurrent(generation)) return undefined;
        return operation({ isCurrent: () => this.isCurrent(generation) });
      });
    const settled = current.then(
      () => undefined,
      () => undefined,
    );
    this.#tails.set(provider, settled);
    void settled.finally(() => {
      if (this.#tails.get(provider) === settled) {
        this.#tails.delete(provider);
      }
    });
    return current;
  }

  invalidate(): void {
    this.#generation += 1;
  }

  dispose(): void {
    this.#disposed = true;
    this.invalidate();
  }

  private isCurrent(generation: number): boolean {
    return !this.#disposed && generation === this.#generation;
  }
}

export interface RegisterProviderApiKeyCommandsOptions {
  readonly storages: Readonly<Record<ProviderId, ApiKeySecretStorage>>;
  readonly presence: ProviderApiKeyPresenceReader;
  readonly coordinator?: ProviderApiKeyOperationCoordinator;
  readonly registerCommand: (
    commandId: string,
    handler: () => Promise<ProviderOnboardingActionResult>,
  ) => Disposable;
  readonly showInputBox: (options: InputBoxOptions) => Thenable<string | undefined>;
  readonly showWarningMessage: (
    message: string,
    options: MessageOptions,
    item: string,
  ) => Thenable<string | undefined>;
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
  options: RegisterProviderApiKeyCommandOptions,
  operation: ProviderApiKeyCommandOperation = "save",
): Disposable {
  const definition = providerApiKeyLifecycleCommandDefinitions.find(
    (candidate) => candidate.provider === provider && candidate.operation === operation,
  );
  if (definition === undefined) {
    throw new Error(`Unsupported provider API key command: ${provider}/${operation}`);
  }

  const coordinator = options.coordinator ?? new ProviderApiKeyOperationCoordinator();
  return options.registerCommand(definition.commandId, async () => {
    const result = await coordinator.run(provider, (context) =>
      runProviderApiKeyCommand({ ...options, definition, context }),
    );
    return result ?? { status: "cancelled" };
  });
}

export function registerProviderApiKeyCommands({
  coordinator = new ProviderApiKeyOperationCoordinator(),
  ...options
}: RegisterProviderApiKeyCommandsOptions): Disposable {
  const registrations = providerApiKeyLifecycleCommandDefinitions.map(({ provider, operation }) =>
    registerProviderApiKeyCommand(
      provider,
      { ...options, coordinator, storage: options.storages[provider] },
      operation,
    ),
  );

  return {
    dispose() {
      for (const registration of registrations) {
        registration.dispose();
      }
    },
  };
}

interface RunProviderApiKeyCommandOptions extends RegisterProviderApiKeyCommandOptions {
  readonly definition: ProviderApiKeyCommandDefinition;
  readonly context: ProviderApiKeyOperationContext;
}

async function runProviderApiKeyCommand({
  definition,
  storage,
  presence,
  context,
  showInputBox,
  showWarningMessage,
  showInformationMessage,
  showErrorMessage,
}: RunProviderApiKeyCommandOptions): Promise<ProviderOnboardingActionResult> {
  if (definition.operation === "delete") {
    return deleteProviderApiKey({
      definition,
      storage,
      presence,
      context,
      showWarningMessage,
      showInformationMessage,
      showErrorMessage,
    });
  }

  return saveOrRotateProviderApiKey({
    definition,
    storage,
    presence,
    context,
    showInputBox,
    showWarningMessage,
    showInformationMessage,
    showErrorMessage,
  });
}

interface SaveOrRotateProviderApiKeyOptions {
  readonly definition: ProviderApiKeyCommandDefinition;
  readonly storage: ApiKeySecretStorage;
  readonly presence: ProviderApiKeyPresenceReader;
  readonly context: ProviderApiKeyOperationContext;
  readonly showInputBox: (options: InputBoxOptions) => Thenable<string | undefined>;
  readonly showWarningMessage: RegisterProviderApiKeyCommandsOptions["showWarningMessage"];
  readonly showInformationMessage: (message: string) => Thenable<unknown>;
  readonly showErrorMessage: (message: string) => Thenable<unknown>;
}

async function saveOrRotateProviderApiKey({
  definition,
  storage,
  presence,
  context,
  showInputBox,
  showWarningMessage,
  showInformationMessage,
  showErrorMessage,
}: SaveOrRotateProviderApiKeyOptions): Promise<ProviderOnboardingActionResult> {
  const apiKey = await showInputBox({
    ignoreFocusOut: true,
    password: true,
    prompt: `Enter the ${definition.inputProviderLabel} API key to store securely on this machine.`,
    title: `CtrlZebra: ${definition.operation === "rotate" ? "Rotate" : "Save"} ${definition.providerLabel} API Key`,
    validateInput: (value) => validateApiKey(value, definition.providerLabel),
  });

  if (apiKey === undefined || !context.isCurrent()) {
    return { status: "cancelled" };
  }

  const validationMessage = validateApiKey(apiKey, definition.providerLabel);
  if (validationMessage !== undefined) {
    await notifyError(context, showErrorMessage, validationMessage);
    return { status: "failed", code: "configuration" };
  }

  const confirmation = await showWarningMessage(
    definition.operation === "rotate"
      ? "Rotating this key will replace any saved key for this provider. Continue?"
      : "Saving this key will replace any saved key for this provider. Continue?",
    { modal: true },
    confirmSaveAction,
  );
  if (confirmation !== confirmSaveAction || !context.isCurrent()) {
    return { status: "cancelled" };
  }

  let mutationFailed = false;
  try {
    await storage.save(apiKey);
  } catch {
    mutationFailed = true;
  }

  const reconciled = await readPresence(presence, definition.provider);
  if (definition.operation === "save") {
    if (mutationFailed) {
      await notifyError(context, showErrorMessage, "Unable to save the API key.");
      return { status: "failed", code: "storage" };
    }
    if (reconciled !== "present") {
      await notifyError(
        context,
        showErrorMessage,
        `Unable to confirm the ${definition.providerLabel} API key after saving. Try again or open Settings.`,
      );
      return { status: "failed", code: "storage" };
    }
    await notifyInformation(
      context,
      showInformationMessage,
      `${definition.providerLabel} API key saved securely.`,
    );
    return { status: "completed" };
  }

  if (mutationFailed || reconciled !== "present") {
    await notifyError(
      context,
      showErrorMessage,
      `Unable to confirm the ${definition.providerLabel} API key after rotation. Try again or open Settings.`,
    );
    return { status: "failed", code: "storage" };
  }

  await notifyInformation(
    context,
    showInformationMessage,
    `${definition.providerLabel} API key rotated securely.`,
  );
  return { status: "completed" };
}

interface DeleteProviderApiKeyOptions {
  readonly definition: ProviderApiKeyCommandDefinition;
  readonly storage: ApiKeySecretStorage;
  readonly presence: ProviderApiKeyPresenceReader;
  readonly context: ProviderApiKeyOperationContext;
  readonly showWarningMessage: RegisterProviderApiKeyCommandsOptions["showWarningMessage"];
  readonly showInformationMessage: (message: string) => Thenable<unknown>;
  readonly showErrorMessage: (message: string) => Thenable<unknown>;
}

async function deleteProviderApiKey({
  definition,
  storage,
  presence,
  context,
  showWarningMessage,
  showInformationMessage,
  showErrorMessage,
}: DeleteProviderApiKeyOptions): Promise<ProviderOnboardingActionResult> {
  const confirmation = await showWarningMessage(
    `Delete the saved ${definition.providerLabel} API key from this machine?`,
    { modal: true },
    confirmDeleteAction,
  );
  if (confirmation !== confirmDeleteAction || !context.isCurrent()) {
    return { status: "cancelled" };
  }

  const currentPresence = await readPresence(presence, definition.provider);
  if (!context.isCurrent()) {
    return { status: "cancelled" };
  }
  if (currentPresence === "unavailable") {
    await notifyError(
      context,
      showErrorMessage,
      `Unable to confirm the ${definition.providerLabel} API key state. Try again or open Settings.`,
    );
    return { status: "failed", code: "storage" };
  }
  if (currentPresence === "absent") {
    await notifyInformation(
      context,
      showInformationMessage,
      `No saved ${definition.providerLabel} API key was found; nothing was deleted.`,
    );
    return { status: "completed" };
  }

  let mutationFailed = false;
  try {
    await storage.delete();
  } catch {
    mutationFailed = true;
  }

  const reconciled = await readPresence(presence, definition.provider);
  if (mutationFailed || reconciled !== "absent") {
    await notifyError(
      context,
      showErrorMessage,
      `Unable to confirm deletion of the ${definition.providerLabel} API key. Try again or open Settings.`,
    );
    return { status: "failed", code: "storage" };
  }

  await notifyInformation(
    context,
    showInformationMessage,
    `${definition.providerLabel} API key deleted.`,
  );
  return { status: "completed" };
}

async function readPresence(
  presence: ProviderApiKeyPresenceReader,
  provider: ProviderId,
): Promise<ProviderApiKeyPresence> {
  try {
    return await presence.read(provider);
  } catch {
    return "unavailable";
  }
}

async function notifyInformation(
  context: ProviderApiKeyOperationContext,
  showInformationMessage: (message: string) => Thenable<unknown>,
  message: string,
): Promise<void> {
  if (context.isCurrent()) {
    await showInformationMessage(message);
  }
}

async function notifyError(
  context: ProviderApiKeyOperationContext,
  showErrorMessage: (message: string) => Thenable<unknown>,
  message: string,
): Promise<void> {
  if (context.isCurrent()) {
    await showErrorMessage(message);
  }
}

function validateApiKey(value: string, providerLabel: string): string | undefined {
  return value.length === 0 ? `Enter a non-empty ${providerLabel} API key.` : undefined;
}
