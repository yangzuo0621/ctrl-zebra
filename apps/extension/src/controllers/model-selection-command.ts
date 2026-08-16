import type {
  CancellationToken,
  Disposable,
  InputBoxOptions,
  QuickPickItem,
  QuickPickOptions,
} from "vscode";

import {
  ApiKeySecretStorageError,
  type ProviderApiKeySecretReader,
} from "../adapters/api-key-secret-storage.js";
import type {
  ProviderId,
  ProviderSelectionConfiguration,
} from "../adapters/provider-configuration.js";
import { isRecord } from "../adapters/record-validation.js";
import { ProviderApiKeyOperationCoordinator } from "./provider-api-key-command.js";
import type { ProviderOnboardingActionResult } from "./provider-onboarding-controller.js";

export const selectModelCommandId = "ctrlZebra.selectModel";

const maxModelListBodyBytes = 256 * 1024;
const maxModelCount = 256;
const maxModelIdCodePoints = 256;
const modelListRequestTimeoutMs = 10_000;

const officialModelListEndpoints = {
  openai: "https://api.openai.com/v1/models",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai/models",
} as const satisfies Partial<Record<ProviderId, string>>;

const providerLabels = {
  openai: "OpenAI",
  gemini: "Gemini",
  "openai-compatible": "OpenAI-Compatible",
} as const satisfies Record<ProviderId, string>;

export interface ModelSelectionCommandOptions {
  readonly isBlocked?: () => boolean;
  readonly registerCommand: (
    commandId: string,
    handler: () => Promise<ProviderOnboardingActionResult>,
  ) => Disposable;
  readonly readConfiguration: () => ProviderSelectionConfiguration;
  readonly secrets: ProviderApiKeySecretReader;
  readonly providerApiKeyCoordinator?: ProviderApiKeyOperationCoordinator;
  readonly updateModel: (modelId: string) => Thenable<void>;
  readonly fetch?: typeof fetch;
  readonly showQuickPick: <T extends QuickPickItem>(
    items: readonly T[],
    options?: QuickPickOptions,
    token?: CancellationToken,
  ) => Thenable<T | undefined>;
  readonly showInputBox: (
    options?: InputBoxOptions,
    token?: CancellationToken,
  ) => Thenable<string | undefined>;
  readonly showInformationMessage: (message: string) => Thenable<unknown>;
  readonly showErrorMessage: (message: string) => Thenable<unknown>;
}

export function registerModelSelectionCommand({
  registerCommand,
  readConfiguration,
  secrets,
  providerApiKeyCoordinator,
  updateModel,
  fetch: fetchModels = globalThis.fetch,
  showQuickPick,
  showInputBox,
  showInformationMessage,
  showErrorMessage,
  isBlocked,
}: ModelSelectionCommandOptions): Disposable {
  return registerCommand(selectModelCommandId, async () => {
    if (isBlocked?.()) {
      return { status: "cancelled" };
    }
    let configuration: ProviderSelectionConfiguration;
    try {
      configuration = readConfiguration();
    } catch {
      await showErrorMessage(
        "The Provider configuration is invalid. Check the CtrlZebra settings.",
      );
      return { status: "failed", code: "configuration" };
    }

    const providerLabel = providerLabels[configuration.provider];
    const listTarget = getOfficialModelListTarget(configuration);

    if (listTarget === undefined) {
      await showInformationMessage(
        `${providerLabel} model discovery is unavailable for this endpoint. Enter a model ID manually.`,
      );
      return promptForModel({
        configuration,
        providerLabel,
        showInputBox,
        showInformationMessage,
        showErrorMessage,
        updateModel,
      });
    }

    const modelIds = await loadOfficialModelIds({
      provider: listTarget.provider,
      endpoint: listTarget.endpoint,
      secrets,
      providerApiKeyCoordinator,
      fetchModels,
      showErrorMessage,
    });

    if (modelIds === undefined || modelIds.length === 0) {
      if (modelIds !== undefined) {
        await showErrorMessage(
          `No ${providerLabel} models are available from the configured API. Enter a model ID manually.`,
        );
      }
      return promptForModel({
        configuration,
        providerLabel,
        showInputBox,
        showInformationMessage,
        showErrorMessage,
        updateModel,
      });
    }

    const selected = await showQuickPick(
      modelIds.map((modelId) => ({ label: modelId })),
      {
        ignoreFocusOut: true,
        title: `CtrlZebra: Select ${providerLabel} Model`,
        placeHolder: "Choose a model",
      },
    );

    if (selected === undefined) {
      return { status: "cancelled" };
    }

    return saveModelSelection({
      modelId: selected.label,
      providerLabel,
      updateModel,
      showInformationMessage,
      showErrorMessage,
    });
  });
}

interface LoadOfficialModelIdsOptions {
  readonly provider: Extract<ProviderId, "openai" | "gemini">;
  readonly endpoint: string;
  readonly secrets: ProviderApiKeySecretReader;
  readonly providerApiKeyCoordinator?: ProviderApiKeyOperationCoordinator;
  readonly fetchModels: typeof fetch;
  readonly showErrorMessage: (message: string) => Thenable<unknown>;
}

async function loadOfficialModelIds({
  provider,
  endpoint,
  secrets,
  providerApiKeyCoordinator,
  fetchModels,
  showErrorMessage,
}: LoadOfficialModelIdsOptions): Promise<readonly string[] | undefined> {
  let apiKey: string | undefined;
  try {
    const coordinator = providerApiKeyCoordinator ?? new ProviderApiKeyOperationCoordinator();
    apiKey = await coordinator.run(provider, () => secrets.read(provider));
  } catch (error) {
    if (!(error instanceof ApiKeySecretStorageError)) {
      await showErrorMessage("Unable to read the saved API key. Enter a model ID manually.");
      return undefined;
    }
    await showErrorMessage(error.message);
    return undefined;
  }

  if (apiKey === undefined || apiKey.length === 0) {
    await showErrorMessage(
      `No ${providerLabels[provider]} API key is saved. Enter a model ID manually.`,
    );
    return undefined;
  }

  const timeout = new AbortController();
  const timeoutHandle = setTimeout(() => timeout.abort(), modelListRequestTimeoutMs);

  try {
    const response = await fetchModels(endpoint, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      redirect: "error",
      signal: timeout.signal,
    });

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      if (response.status === 401 || response.status === 403) {
        await showErrorMessage(
          `${providerLabels[provider]} rejected the saved API key. Enter a model ID manually.`,
        );
      } else {
        await showErrorMessage(
          `Unable to load ${providerLabels[provider]} models. Enter a model ID manually.`,
        );
      }
      return undefined;
    }

    const body = await readBoundedResponseBody(response, timeout.signal);
    const modelIds = parseModelList(body);
    if (modelIds === undefined) {
      await showErrorMessage(
        `The ${providerLabels[provider]} model list was not usable. Enter a model ID manually.`,
      );
      return undefined;
    }

    return modelIds;
  } catch (error) {
    if (error instanceof BoundedResponseError) {
      await showErrorMessage(
        "The model list response was too large or malformed. Enter a model ID manually.",
      );
      return undefined;
    }
    await showErrorMessage(
      `Unable to load ${providerLabels[provider]} models. Enter a model ID manually.`,
    );
    return undefined;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

interface PromptForModelOptions {
  readonly configuration: ProviderSelectionConfiguration;
  readonly providerLabel: string;
  readonly showInputBox: ModelSelectionCommandOptions["showInputBox"];
  readonly showInformationMessage: (message: string) => Thenable<unknown>;
  readonly showErrorMessage: (message: string) => Thenable<unknown>;
  readonly updateModel: (modelId: string) => Thenable<void>;
}

async function promptForModel({
  configuration,
  providerLabel,
  showInputBox,
  showInformationMessage,
  showErrorMessage,
  updateModel,
}: PromptForModelOptions): Promise<ProviderOnboardingActionResult> {
  const modelId = await showInputBox({
    ignoreFocusOut: true,
    title: `CtrlZebra: Enter ${providerLabel} Model ID`,
    prompt: "Enter the exact model ID to save on this machine.",
    value: configuration.modelId,
    validateInput: (value) => validateModelId(value),
  });

  if (modelId === undefined) {
    return { status: "cancelled" };
  }

  const validationMessage = validateModelId(modelId);
  if (validationMessage !== undefined) {
    await showErrorMessage(validationMessage);
    return { status: "failed", code: "configuration" };
  }

  return saveModelSelection({
    modelId,
    providerLabel,
    updateModel,
    showInformationMessage,
    showErrorMessage,
  });
}

interface SaveModelSelectionOptions {
  readonly modelId: string;
  readonly providerLabel: string;
  readonly updateModel: (modelId: string) => Thenable<void>;
  readonly showInformationMessage: (message: string) => Thenable<unknown>;
  readonly showErrorMessage: (message: string) => Thenable<unknown>;
}

async function saveModelSelection({
  modelId,
  providerLabel,
  updateModel,
  showInformationMessage,
  showErrorMessage,
}: SaveModelSelectionOptions): Promise<ProviderOnboardingActionResult> {
  try {
    await updateModel(modelId);
  } catch {
    await showErrorMessage("Unable to save the model selection. The existing model was kept.");
    return { status: "failed", code: "storage" };
  }

  await showInformationMessage(`${providerLabel} model saved: ${modelId}`);
  return { status: "completed" };
}

function getOfficialModelListTarget(configuration: ProviderSelectionConfiguration):
  | {
      readonly provider: Extract<ProviderId, "openai" | "gemini">;
      readonly endpoint: string;
    }
  | undefined {
  if (configuration.endpoint !== undefined || configuration.provider === "openai-compatible") {
    return undefined;
  }

  const endpoint = officialModelListEndpoints[configuration.provider];
  return endpoint === undefined ? undefined : { provider: configuration.provider, endpoint };
}

function validateModelId(value: string): string | undefined {
  if (value.length === 0 || value.trim() !== value) {
    return "Enter a non-empty model ID without surrounding whitespace.";
  }
  if ([...value].length > maxModelIdCodePoints) {
    return "The model ID is too long.";
  }
  if (value.includes(String.fromCharCode(0)) || value.includes("\r") || value.includes("\n")) {
    return "The model ID contains unsupported control characters.";
  }
  return undefined;
}

function parseModelList(body: string): readonly string[] | undefined {
  let document: unknown;
  try {
    document = JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }

  if (
    !isRecord(document) ||
    !Array.isArray(document.data) ||
    document.data.length > maxModelCount
  ) {
    return undefined;
  }

  const modelIds: string[] = [];
  for (const item of document.data) {
    if (!isRecord(item) || typeof item.id !== "string") {
      return undefined;
    }
    const modelId = item.id;
    if (validateModelId(modelId) !== undefined) {
      return undefined;
    }
    if (!modelIds.includes(modelId)) {
      modelIds.push(modelId);
    }
  }

  return modelIds;
}

async function readBoundedResponseBody(response: Response, signal: AbortSignal): Promise<string> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const declaredLength = Number(contentLength);
    if (Number.isSafeInteger(declaredLength) && declaredLength > maxModelListBodyBytes) {
      throw new BoundedResponseError();
    }
  }

  if (response.body === null) {
    throw new BoundedResponseError();
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const chunks: string[] = [];
  let bytesRead = 0;

  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      bytesRead += value.byteLength;
      if (bytesRead > maxModelListBodyBytes) {
        await reader.cancel();
        throw new BoundedResponseError();
      }
      chunks.push(decodeResponseChunk(decoder, value, true));
    }
    chunks.push(decodeResponseChunk(decoder, undefined, false));
    return chunks.join("");
  } catch (error) {
    if (error instanceof BoundedResponseError) {
      throw error;
    }
    throw error;
  } finally {
    reader.releaseLock();
  }
}

function decodeResponseChunk(
  decoder: InstanceType<typeof TextDecoder>,
  value: Uint8Array | undefined,
  stream: boolean,
): string {
  try {
    return decoder.decode(value, { stream });
  } catch (error) {
    if (error instanceof TypeError) {
      throw new BoundedResponseError();
    }
    throw error;
  }
}

class BoundedResponseError extends Error {
  constructor() {
    super("The model list response is invalid or exceeds the safety limit.");
    this.name = "BoundedResponseError";
  }
}
