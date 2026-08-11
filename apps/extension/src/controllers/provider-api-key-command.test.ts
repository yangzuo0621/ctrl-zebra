import { describe, expect, it, vi } from "vitest";
import type { Disposable, InputBoxOptions, MessageOptions } from "vscode";

import {
  type ApiKeySecretStorage,
  ApiKeySecretStorageError,
} from "../adapters/api-key-secret-storage.js";
import {
  providerApiKeyCommandDefinitions,
  registerProviderApiKeyCommands,
  saveGeminiApiKeyCommandId,
  saveOpenAIApiKeyCommandId,
  saveOpenAICompatibleApiKeyCommandId,
} from "./provider-api-key-command.js";

describe("Provider API key commands", () => {
  it("registers discoverable commands for all supported providers and owns their registrations", async () => {
    const harness = createHarness("test-openai-api-key");
    const disposable = registerProviderApiKeyCommands(harness.options);

    expect([...harness.handlers.keys()]).toEqual([
      saveOpenAIApiKeyCommandId,
      saveGeminiApiKeyCommandId,
      saveOpenAICompatibleApiKeyCommandId,
    ]);

    await harness.run(saveOpenAICompatibleApiKeyCommandId);
    expect(harness.storages["openai-compatible"].save).toHaveBeenCalledWith("test-openai-api-key");
    expect(harness.showInputBox).toHaveBeenCalledWith(
      expect.objectContaining({
        ignoreFocusOut: true,
        password: true,
        prompt: "Enter the OpenAI-Compatible API key to store securely on this machine.",
        title: "CtrlZebra: Save OpenAI-Compatible API Key",
      }),
    );
    expect(harness.showWarningMessage).toHaveBeenCalledWith(
      "Saving this key will replace any saved key for this provider. Continue?",
      { modal: true },
      "Replace",
    );
    expect(harness.showInformationMessage).toHaveBeenCalledWith(
      "OpenAI-Compatible API key saved securely.",
    );

    disposable.dispose();
    for (const registration of harness.disposables) {
      expect(registration.dispose).toHaveBeenCalledOnce();
    }
  });

  it.each(
    providerApiKeyCommandDefinitions,
  )("$provider cancels without writing or reporting success", async ({ commandId, provider }) => {
    const harness = createHarness(undefined);
    const disposable = registerProviderApiKeyCommands(harness.options);

    await harness.run(commandId);

    expect(harness.storages[provider].save).not.toHaveBeenCalled();
    expect(harness.showWarningMessage).not.toHaveBeenCalled();
    expect(harness.showInformationMessage).not.toHaveBeenCalled();
    expect(harness.showErrorMessage).not.toHaveBeenCalled();
    disposable.dispose();
  });

  it("rejects an empty result even when the host bypasses input validation", async () => {
    const harness = createHarness("");
    registerProviderApiKeyCommands(harness.options);

    await harness.run(saveGeminiApiKeyCommandId);

    const inputOptions = harness.showInputBox.mock.calls[0]?.[0];
    expect(await inputOptions?.validateInput?.("")).toBe("Enter a non-empty Gemini API key.");
    expect(await inputOptions?.validateInput?.("test-gemini-api-key")).toBeUndefined();
    expect(harness.storages.gemini.save).not.toHaveBeenCalled();
    expect(harness.showWarningMessage).not.toHaveBeenCalled();
    expect(harness.showErrorMessage).toHaveBeenCalledWith("Enter a non-empty Gemini API key.");
  });

  it("does not replace a saved key when overwrite confirmation is cancelled", async () => {
    const harness = createHarness("test-openai-api-key");
    harness.confirmation = undefined;
    registerProviderApiKeyCommands(harness.options);

    await harness.run(saveOpenAIApiKeyCommandId);

    expect(harness.storages.openai.save).not.toHaveBeenCalled();
    expect(harness.showInformationMessage).not.toHaveBeenCalled();
    expect(harness.showErrorMessage).not.toHaveBeenCalled();
  });

  it("maps SecretStorage failures without exposing the submitted key", async () => {
    const harness = createHarness("test-gemini-api-key");
    harness.storages.gemini.save.mockRejectedValue(new ApiKeySecretStorageError("save"));
    registerProviderApiKeyCommands(harness.options);

    await harness.run(saveGeminiApiKeyCommandId);

    expect(harness.showErrorMessage).toHaveBeenCalledWith("Unable to save the API key.");
    expect(String(harness.showErrorMessage.mock.calls)).not.toContain("test-gemini-api-key");
    expect(harness.showInformationMessage).not.toHaveBeenCalled();
  });

  it("maps unexpected storage failures to fixed safe text", async () => {
    const harness = createHarness("test-openai-api-key");
    harness.storages.openai.save.mockRejectedValue(
      new Error("backend failure contains test-openai-api-key"),
    );
    registerProviderApiKeyCommands(harness.options);

    await harness.run(saveOpenAIApiKeyCommandId);

    expect(harness.showErrorMessage).toHaveBeenCalledWith("Unable to save the API key.");
    expect(String(harness.showErrorMessage.mock.calls)).not.toContain("test-openai-api-key");
    expect(harness.showInformationMessage).not.toHaveBeenCalled();
  });
});

interface Harness {
  readonly options: Parameters<typeof registerProviderApiKeyCommands>[0];
  readonly handlers: Map<string, () => Promise<void>>;
  readonly disposables: readonly Disposable[];
  readonly storages: Record<"openai" | "gemini" | "openai-compatible", TestStorage>;
  readonly showInputBox: ReturnType<
    typeof vi.fn<(options: InputBoxOptions) => Promise<string | undefined>>
  >;
  readonly showWarningMessage: ReturnType<
    typeof vi.fn<
      (message: string, options: MessageOptions, item: "Replace") => Promise<"Replace" | undefined>
    >
  >;
  readonly showInformationMessage: ReturnType<typeof vi.fn<(message: string) => Promise<unknown>>>;
  readonly showErrorMessage: ReturnType<typeof vi.fn<(message: string) => Promise<unknown>>>;
  confirmation: "Replace" | undefined;
  run(commandId: string): Promise<void>;
}

interface TestStorage extends Omit<ApiKeySecretStorage, "save"> {
  readonly save: ReturnType<typeof vi.fn<(apiKey: string) => Promise<void>>>;
}

function createHarness(input: string | undefined): Harness {
  const handlers = new Map<string, () => Promise<void>>();
  const disposables = providerApiKeyCommandDefinitions.map(() => ({ dispose: vi.fn() }));
  const storages = {
    openai: createStorage(),
    gemini: createStorage(),
    "openai-compatible": createStorage(),
  } satisfies Record<"openai" | "gemini" | "openai-compatible", TestStorage>;
  const showInputBox = vi.fn(async (_options: InputBoxOptions) => input);
  const showWarningMessage = vi.fn(
    async (
      _message: string,
      _options: MessageOptions,
      _item: "Replace",
    ): Promise<"Replace" | undefined> => "Replace",
  );
  const showInformationMessage = vi.fn(async (_message: string) => undefined);
  const showErrorMessage = vi.fn(async (_message: string) => undefined);
  let registrationIndex = 0;

  const harness: Harness = {
    options: {
      storages,
      registerCommand: vi.fn((commandId, handler) => {
        handlers.set(commandId, handler);
        return disposables[registrationIndex++] ?? { dispose: vi.fn() };
      }),
      showInputBox,
      showWarningMessage,
      showInformationMessage,
      showErrorMessage,
    },
    handlers,
    disposables,
    storages,
    showInputBox,
    showWarningMessage,
    showInformationMessage,
    showErrorMessage,
    confirmation: "Replace",
    async run(commandId) {
      showWarningMessage.mockImplementation(
        async (
          _message: string,
          _options: MessageOptions,
          _item: "Replace",
        ): Promise<"Replace" | undefined> => harness.confirmation,
      );
      const handler = handlers.get(commandId);
      if (handler === undefined) {
        throw new Error(`Expected ${commandId} to be registered.`);
      }
      await handler();
    },
  };
  return harness;
}

function createStorage(): TestStorage {
  return {
    read: vi.fn(async () => undefined),
    save: vi.fn(async (_apiKey: string) => undefined),
    delete: vi.fn(async () => undefined),
  };
}
