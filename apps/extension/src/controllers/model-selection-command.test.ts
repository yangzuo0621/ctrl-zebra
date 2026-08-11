import { describe, expect, it, vi } from "vitest";
import type { Disposable, InputBoxOptions, QuickPickItem } from "vscode";

import type { ProviderApiKeySecretReader } from "../adapters/api-key-secret-storage.js";
import type { ProviderSelectionConfiguration } from "../adapters/provider-configuration.js";
import {
  type ModelSelectionCommandOptions,
  registerModelSelectionCommand,
  selectModelCommandId,
} from "./model-selection-command.js";

describe("Model selection command", () => {
  it("loads the official OpenAI list, extracts only data IDs, and saves the chosen model", async () => {
    const harness = createHarness({
      configuration: { provider: "openai", modelId: "old-model" },
      modelList: {
        object: "list",
        data: [
          { id: "gpt-test", owned_by: "openai", secret: "discard-me" },
          { id: "gpt-other", created: 123 },
          { id: "gpt-test", object: "model" },
        ],
        unexpected: "discard-me",
      },
      selectedItem: 1,
    });

    registerModelSelectionCommand(harness.options);
    await harness.run();

    expect(harness.fetch).toHaveBeenCalledWith(
      "https://api.openai.com/v1/models",
      expect.objectContaining({
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: "Bearer test-openai-api-key",
        },
        redirect: "error",
      }),
    );
    expect(harness.fetch.mock.calls[0]?.[1]).not.toHaveProperty("body");
    expect(harness.quickPickItems).toEqual([{ label: "gpt-test" }, { label: "gpt-other" }]);
    expect(harness.updateModel).toHaveBeenCalledWith("gpt-other");
    expect(harness.showInformationMessage).toHaveBeenCalledWith("OpenAI model saved: gpt-other");
  });

  it("uses the official Gemini endpoint and falls back to manual input for an empty list", async () => {
    const harness = createHarness({
      configuration: { provider: "gemini" },
      modelList: { object: "list", data: [] },
      manualModelId: "gemini-manual",
    });

    registerModelSelectionCommand(harness.options);
    await harness.run();

    expect(harness.fetch).toHaveBeenCalledWith(
      "https://generativelanguage.googleapis.com/v1beta/openai/models",
      expect.any(Object),
    );
    expect(harness.inputBoxOptions).toEqual(
      expect.objectContaining({ title: "CtrlZebra: Enter Gemini Model ID" }),
    );
    expect(harness.updateModel).toHaveBeenCalledWith("gemini-manual");
    expect(harness.showErrorMessage).toHaveBeenCalledWith(
      "No Gemini models are available from the configured API. Enter a model ID manually.",
    );
  });

  it("falls back to manual input after a network failure without exposing the cause", async () => {
    const harness = createHarness({
      configuration: { provider: "openai" },
      fetchFailure: new Error("network response includes test-secret"),
      manualModelId: "gpt-manual",
    });

    registerModelSelectionCommand(harness.options);
    await harness.run();

    expect(harness.updateModel).toHaveBeenCalledWith("gpt-manual");
    expect(String(harness.showErrorMessage.mock.calls)).not.toContain("test-secret");
    expect(harness.showErrorMessage).toHaveBeenCalledWith(
      "Unable to load OpenAI models. Enter a model ID manually.",
    );
  });

  it("does not request a list when no API key is saved", async () => {
    const harness = createHarness({
      configuration: { provider: "openai" },
      apiKey: "",
      manualModelId: "gpt-manual",
    });

    registerModelSelectionCommand(harness.options);
    await harness.run();

    expect(harness.fetch).not.toHaveBeenCalled();
    expect(harness.updateModel).toHaveBeenCalledWith("gpt-manual");
    expect(harness.showErrorMessage).toHaveBeenCalledWith(
      "No OpenAI API key is saved. Enter a model ID manually.",
    );
  });

  it.each([
    [
      "openai-compatible",
      { provider: "openai-compatible", endpoint: "https://models.example.test/v1" },
    ],
    ["custom OpenAI endpoint", { provider: "openai", endpoint: "https://proxy.example.test/v1" }],
  ] as const)("uses manual input for %s without network access", async (_name, configuration) => {
    const harness = createHarness({ configuration, manualModelId: "manual-model" });

    registerModelSelectionCommand(harness.options);
    await harness.run();

    expect(harness.fetch).not.toHaveBeenCalled();
    expect(harness.updateModel).toHaveBeenCalledWith("manual-model");
  });

  it("does not write when the Quick Pick is cancelled", async () => {
    const harness = createHarness({
      configuration: { provider: "openai", modelId: "old-model" },
      modelList: { object: "list", data: [{ id: "gpt-test" }] },
      selectedItem: null,
    });

    registerModelSelectionCommand(harness.options);
    await harness.run();

    expect(harness.updateModel).not.toHaveBeenCalled();
    expect(harness.showInformationMessage).not.toHaveBeenCalled();
  });

  it("keeps the previous model when configuration writing fails", async () => {
    const harness = createHarness({
      configuration: { provider: "openai", modelId: "old-model" },
      modelList: { object: "list", data: [{ id: "gpt-test" }] },
      selectedItem: 0,
      updateFailure: new Error("settings backend contains secret"),
    });

    registerModelSelectionCommand(harness.options);
    await harness.run();

    expect(harness.showInformationMessage).not.toHaveBeenCalled();
    expect(harness.showErrorMessage).toHaveBeenCalledWith(
      "Unable to save the model selection. The existing model was kept.",
    );
    expect(String(harness.showErrorMessage.mock.calls)).not.toContain("secret");
  });

  it("rejects malformed model list objects and uses manual input", async () => {
    const harness = createHarness({
      configuration: { provider: "openai" },
      modelList: { object: "list", data: [{ id: "valid" }, { object: "model" }] },
      manualModelId: "gpt-manual",
    });

    registerModelSelectionCommand(harness.options);
    await harness.run();

    expect(harness.updateModel).toHaveBeenCalledWith("gpt-manual");
    expect(harness.showErrorMessage).toHaveBeenCalledWith(
      "The OpenAI model list was not usable. Enter a model ID manually.",
    );
  });
});

interface HarnessOptions {
  readonly configuration: ProviderSelectionConfiguration;
  readonly apiKey?: string;
  readonly modelList?: unknown;
  readonly fetchFailure?: Error;
  readonly manualModelId?: string;
  readonly selectedItem?: number | null;
  readonly updateFailure?: Error;
}

interface Harness {
  readonly options: Parameters<typeof registerModelSelectionCommand>[0];
  readonly handlers: Map<string, () => Promise<void>>;
  readonly fetch: ReturnType<typeof vi.fn<typeof globalThis.fetch>>;
  readonly quickPickItems: QuickPickItem[];
  readonly inputBoxOptions: InputBoxOptions | undefined;
  readonly updateModel: ReturnType<typeof vi.fn<(modelId: string) => Promise<void>>>;
  readonly showInformationMessage: ReturnType<typeof vi.fn<(message: string) => Promise<unknown>>>;
  readonly showErrorMessage: ReturnType<typeof vi.fn<(message: string) => Promise<unknown>>>;
  run(): Promise<void>;
}

function createHarness({
  configuration,
  apiKey,
  modelList,
  fetchFailure,
  manualModelId,
  selectedItem,
  updateFailure,
}: HarnessOptions): Harness {
  const handlers = new Map<string, () => Promise<void>>();
  const quickPickItems: QuickPickItem[] = [];
  let inputBoxOptions: InputBoxOptions | undefined;
  const fetch = vi.fn<typeof globalThis.fetch>(async () => {
    if (fetchFailure !== undefined) {
      throw fetchFailure;
    }
    return new Response(JSON.stringify(modelList), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  const updateModel = vi.fn(async (_modelId: string) => {
    if (updateFailure !== undefined) {
      throw updateFailure;
    }
  });
  const showInformationMessage = vi.fn(async (_message: string) => undefined);
  const showErrorMessage = vi.fn(async (_message: string) => undefined);
  const showQuickPick: ModelSelectionCommandOptions["showQuickPick"] = async <
    T extends QuickPickItem,
  >(
    items: readonly T[],
  ) => {
    quickPickItems.push(...items);
    return selectedItem === null ? undefined : items[selectedItem ?? 0];
  };
  const options = {
    registerCommand: vi.fn((commandId, handler) => {
      handlers.set(commandId, handler);
      return { dispose: vi.fn() } satisfies Disposable;
    }),
    readConfiguration: () => configuration,
    secrets: {
      read: vi.fn(async () => apiKey ?? "test-openai-api-key"),
    } satisfies ProviderApiKeySecretReader,
    updateModel,
    fetch,
    showQuickPick,
    showInputBox: vi.fn(async (options?: InputBoxOptions) => {
      inputBoxOptions = options;
      return manualModelId;
    }),
    showInformationMessage,
    showErrorMessage,
  } satisfies Parameters<typeof registerModelSelectionCommand>[0];

  return {
    options,
    handlers,
    fetch,
    quickPickItems,
    get inputBoxOptions() {
      return inputBoxOptions;
    },
    updateModel,
    showInformationMessage,
    showErrorMessage,
    async run() {
      const handler = handlers.get(selectModelCommandId);
      if (handler === undefined) {
        throw new Error(`Expected ${selectModelCommandId} to be registered.`);
      }
      await handler();
    },
  };
}
