import { describe, expect, it, vi } from "vitest";
import type { Disposable, InputBoxOptions, MessageOptions } from "vscode";

import type {
  ApiKeySecretStorage,
  ProviderApiKeyPresence,
  ProviderApiKeyPresenceReader,
} from "../adapters/api-key-secret-storage.js";
import {
  deleteGeminiApiKeyCommandId,
  deleteOpenAIApiKeyCommandId,
  deleteOpenAICompatibleApiKeyCommandId,
  ProviderApiKeyOperationCoordinator,
  providerApiKeyCommandDefinitions,
  providerApiKeyLifecycleCommandDefinitions,
  registerProviderApiKeyCommands,
  rotateOpenAIApiKeyCommandId,
  saveGeminiApiKeyCommandId,
  saveOpenAIApiKeyCommandId,
  saveOpenAICompatibleApiKeyCommandId,
} from "./provider-api-key-command.js";

const providers = ["openai", "gemini", "openai-compatible"] as const;

describe("Provider API key commands", () => {
  it("registers discoverable save, rotate, and delete commands for every provider", async () => {
    const harness = createHarness("test-openai-compatible-api-key", ["openai-compatible"]);
    const disposable = registerProviderApiKeyCommands(harness.options);

    expect([...harness.handlers.keys()]).toEqual(
      providerApiKeyLifecycleCommandDefinitions.map(({ commandId }) => commandId),
    );

    await harness.run(saveOpenAICompatibleApiKeyCommandId);
    expect(harness.storages["openai-compatible"].save).toHaveBeenCalledWith(
      "test-openai-compatible-api-key",
    );
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
  )("$provider save cancels without writing or reporting success", async ({
    commandId,
    provider,
  }) => {
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
    const harness = createHarness("test-openai-api-key", ["openai"]);
    harness.setConfirmation(undefined);
    registerProviderApiKeyCommands(harness.options);

    await harness.run(saveOpenAIApiKeyCommandId);

    expect(harness.storages.openai.save).not.toHaveBeenCalled();
    expect(harness.showInformationMessage).not.toHaveBeenCalled();
    expect(harness.showErrorMessage).not.toHaveBeenCalled();
  });

  it("maps SecretStorage failures without exposing the submitted key", async () => {
    const harness = createHarness("test-gemini-api-key");
    harness.storages.gemini.save.mockRejectedValue(new Error("backend contains submitted key"));
    registerProviderApiKeyCommands(harness.options);

    await harness.run(saveGeminiApiKeyCommandId);

    expect(harness.showErrorMessage).toHaveBeenCalledWith("Unable to save the API key.");
    expect(String(harness.showErrorMessage.mock.calls)).not.toContain("test-gemini-api-key");
    expect(harness.showInformationMessage).not.toHaveBeenCalled();
  });

  it("rotates with one direct save and only reconciles presence after settlement", async () => {
    const harness = createHarness("test-openai-api-key", ["openai"]);
    registerProviderApiKeyCommands(harness.options);

    await harness.run(rotateOpenAIApiKeyCommandId);

    expect(harness.storages.openai.save).toHaveBeenCalledTimes(1);
    expect(harness.presence.read).toHaveBeenCalledTimes(1);
    expect(harness.presence.read).toHaveBeenCalledWith("openai");
    expect(harness.showInputBox).toHaveBeenCalledWith(
      expect.objectContaining({
        password: true,
        ignoreFocusOut: true,
        title: "CtrlZebra: Rotate OpenAI API Key",
      }),
    );
    expect(harness.showWarningMessage).toHaveBeenCalledWith(
      "Rotating this key will replace any saved key for this provider. Continue?",
      { modal: true },
      "Replace",
    );
    expect(harness.showInformationMessage).toHaveBeenCalledWith("OpenAI API key rotated securely.");
  });

  it("rotates an absent key as a first save without a presence preflight", async () => {
    const harness = createHarness("test-openai-api-key");
    registerProviderApiKeyCommands(harness.options);

    await harness.run(rotateOpenAIApiKeyCommandId);

    expect(harness.storages.openai.save).toHaveBeenCalledTimes(1);
    expect(harness.presence.read).toHaveBeenCalledTimes(1);
    expect(harness.showInformationMessage).toHaveBeenCalledWith("OpenAI API key rotated securely.");
  });

  it("treats a rejected rotation as indeterminate and does not compensate", async () => {
    const submittedKey = "test-openai-api-key";
    const harness = createHarness(submittedKey, ["openai"]);
    harness.storages.openai.save.mockRejectedValue(new Error("secret backend failure"));
    registerProviderApiKeyCommands(harness.options);

    await harness.run(rotateOpenAIApiKeyCommandId);

    expect(harness.storages.openai.delete).not.toHaveBeenCalled();
    expect(harness.presence.read).toHaveBeenCalledTimes(1);
    expect(harness.showErrorMessage).toHaveBeenCalledWith(
      "Unable to confirm the OpenAI API key after rotation. Try again or open Settings.",
    );
    expect(String(harness.showErrorMessage.mock.calls)).not.toContain(submittedKey);
    expect(harness.showInformationMessage).not.toHaveBeenCalled();
  });

  it("reports rotation reconciliation failure with fixed safe text", async () => {
    const harness = createHarness("test-openai-api-key", ["openai"]);
    harness.presence.read.mockResolvedValue("unavailable");
    registerProviderApiKeyCommands(harness.options);

    await harness.run(rotateOpenAIApiKeyCommandId);

    expect(harness.storages.openai.save).toHaveBeenCalledTimes(1);
    expect(harness.showErrorMessage).toHaveBeenCalledWith(
      "Unable to confirm the OpenAI API key after rotation. Try again or open Settings.",
    );
  });

  it("deletes a present key only after Provider-only confirmation and reconciliation", async () => {
    const harness = createHarness(undefined, ["openai"]);
    harness.setConfirmation("Delete");
    registerProviderApiKeyCommands(harness.options);

    await harness.run(deleteOpenAIApiKeyCommandId);

    expect(harness.showWarningMessage).toHaveBeenCalledWith(
      "Delete the saved OpenAI API key from this machine?",
      { modal: true },
      "Delete",
    );
    expect(harness.storages.openai.delete).toHaveBeenCalledTimes(1);
    expect(harness.presence.read).toHaveBeenCalledTimes(2);
    expect(harness.showInformationMessage).toHaveBeenCalledWith("OpenAI API key deleted.");
    expect(String(harness.showWarningMessage.mock.calls)).not.toContain("test-");
  });

  it("does not call delete when the presence preflight is absent", async () => {
    const harness = createHarness(undefined);
    harness.setConfirmation("Delete");
    registerProviderApiKeyCommands(harness.options);

    await harness.run(deleteGeminiApiKeyCommandId);

    expect(harness.presence.read).toHaveBeenCalledTimes(1);
    expect(harness.storages.gemini.delete).not.toHaveBeenCalled();
    expect(harness.showInformationMessage).toHaveBeenCalledWith(
      "No saved Gemini API key was found; nothing was deleted.",
    );
  });

  it("does not call delete when presence is unavailable", async () => {
    const harness = createHarness(undefined, ["gemini"]);
    harness.setConfirmation("Delete");
    harness.presence.read.mockResolvedValue("unavailable");
    registerProviderApiKeyCommands(harness.options);

    await harness.run(deleteGeminiApiKeyCommandId);

    expect(harness.storages.gemini.delete).not.toHaveBeenCalled();
    expect(harness.presence.read).toHaveBeenCalledTimes(1);
    expect(harness.showErrorMessage).toHaveBeenCalledWith(
      "Unable to confirm the Gemini API key state. Try again or open Settings.",
    );
  });

  it("treats a rejected delete as indeterminate without claiming the old value remains", async () => {
    const harness = createHarness(undefined, ["openai-compatible"]);
    harness.setConfirmation("Delete");
    harness.storages["openai-compatible"].delete.mockRejectedValue(
      new Error("secret backend failure"),
    );
    registerProviderApiKeyCommands(harness.options);

    await harness.run(deleteOpenAICompatibleApiKeyCommandId);

    expect(harness.storages["openai-compatible"].delete).toHaveBeenCalledTimes(1);
    expect(harness.presence.read).toHaveBeenCalledTimes(2);
    expect(harness.showErrorMessage).toHaveBeenCalledWith(
      "Unable to confirm deletion of the OpenAI-Compatible API key. Try again or open Settings.",
    );
  });

  it("does not call storage when delete confirmation is cancelled", async () => {
    const harness = createHarness(undefined, ["openai"]);
    harness.setConfirmation(undefined);
    registerProviderApiKeyCommands(harness.options);

    await harness.run(deleteOpenAIApiKeyCommandId);

    expect(harness.presence.read).not.toHaveBeenCalled();
    expect(harness.storages.openai.delete).not.toHaveBeenCalled();
  });

  it("serializes same-provider commands while allowing different providers to proceed", async () => {
    const harness = createHarness("test-openai-api-key", ["openai", "gemini"]);
    const firstSave = deferred<void>();
    harness.storages.openai.save.mockImplementationOnce(() => firstSave.promise);
    registerProviderApiKeyCommands(harness.options);

    const first = harness.run(saveOpenAIApiKeyCommandId);
    await flush();
    const second = harness.run(rotateOpenAIApiKeyCommandId);
    const crossProvider = harness.run(saveGeminiApiKeyCommandId);
    await flush();

    expect(harness.storages.openai.save).toHaveBeenCalledTimes(1);
    expect(harness.storages.gemini.save).toHaveBeenCalledTimes(1);

    firstSave.resolve();
    await Promise.all([first, second, crossProvider]);

    expect(harness.storages.openai.save).toHaveBeenCalledTimes(2);
    expect(harness.presence.read).toHaveBeenCalledWith("openai");
  });

  it("suppresses late notifications after coordinator disposal while observing settlement", async () => {
    const harness = createHarness("test-openai-api-key");
    const save = deferred<void>();
    harness.storages.openai.save.mockImplementationOnce(() => save.promise);
    registerProviderApiKeyCommands(harness.options);

    const pending = harness.run(saveOpenAIApiKeyCommandId);
    await flush();
    harness.coordinator.dispose();
    save.resolve();
    await pending;

    expect(harness.showInformationMessage).not.toHaveBeenCalled();
    expect(harness.showErrorMessage).not.toHaveBeenCalled();
  });

  it("suppresses stale-generation notifications after an in-flight save settles", async () => {
    const harness = createHarness("test-openai-api-key");
    const save = deferred<void>();
    harness.storages.openai.save.mockImplementationOnce(() => save.promise);
    registerProviderApiKeyCommands(harness.options);

    const pending = harness.run(saveOpenAIApiKeyCommandId);
    await flush();
    expect(harness.storages.openai.save).toHaveBeenCalledTimes(1);

    harness.coordinator.invalidate();
    save.resolve();
    await pending;

    expect(harness.presence.read).toHaveBeenCalledTimes(1);
    expect(harness.showInformationMessage).not.toHaveBeenCalled();
    expect(harness.showErrorMessage).not.toHaveBeenCalled();
  });
});

interface Harness {
  readonly options: Parameters<typeof registerProviderApiKeyCommands>[0];
  readonly handlers: Map<string, () => Promise<unknown>>;
  readonly disposables: readonly Disposable[];
  readonly coordinator: ProviderApiKeyOperationCoordinator;
  readonly storages: Record<(typeof providers)[number], TestStorage>;
  readonly presence: ProviderApiKeyPresenceReader & {
    readonly read: ReturnType<
      typeof vi.fn<(provider: (typeof providers)[number]) => Promise<ProviderApiKeyPresence>>
    >;
  };
  readonly showInputBox: ReturnType<
    typeof vi.fn<(options: InputBoxOptions) => Promise<string | undefined>>
  >;
  readonly showWarningMessage: ReturnType<
    typeof vi.fn<
      (message: string, options: MessageOptions, item: string) => Promise<string | undefined>
    >
  >;
  readonly showInformationMessage: ReturnType<typeof vi.fn<(message: string) => Promise<unknown>>>;
  readonly showErrorMessage: ReturnType<typeof vi.fn<(message: string) => Promise<unknown>>>;
  setConfirmation(value: string | undefined): void;
  run(commandId: string): Promise<unknown>;
}

interface TestStorage extends ApiKeySecretStorage {
  value: string | undefined;
  readonly save: ReturnType<typeof vi.fn<(apiKey: string) => Promise<void>>>;
  readonly delete: ReturnType<typeof vi.fn<() => Promise<void>>>;
}

function createHarness(
  input: string | undefined,
  initiallyPresent: readonly (typeof providers)[number][] = [],
): Harness {
  const handlers = new Map<string, () => Promise<unknown>>();
  const disposables = providerApiKeyLifecycleCommandDefinitions.map(() => ({ dispose: vi.fn() }));
  const storages = {
    openai: createStorage(initiallyPresent.includes("openai")),
    gemini: createStorage(initiallyPresent.includes("gemini")),
    "openai-compatible": createStorage(initiallyPresent.includes("openai-compatible")),
  } satisfies Record<(typeof providers)[number], TestStorage>;
  const showInputBox = vi.fn(async (_options: InputBoxOptions) => input);
  let confirmation: string | undefined = "Replace";
  const showWarningMessage = vi.fn(
    async (
      _message: string,
      _options: MessageOptions,
      _item: string,
    ): Promise<string | undefined> => confirmation,
  );
  const showInformationMessage = vi.fn(async (_message: string) => undefined);
  const showErrorMessage = vi.fn(async (_message: string) => undefined);
  const presence = {
    read: vi.fn(async (provider: (typeof providers)[number]) =>
      storages[provider].value === undefined ? "absent" : "present",
    ),
  } satisfies ProviderApiKeyPresenceReader;
  const coordinator = new ProviderApiKeyOperationCoordinator();
  let registrationIndex = 0;

  const harness: Harness = {
    options: {
      coordinator,
      storages,
      presence,
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
    coordinator,
    storages,
    presence,
    showInputBox,
    showWarningMessage,
    showInformationMessage,
    showErrorMessage,
    setConfirmation(value) {
      confirmation = value;
    },
    async run(commandId) {
      const handler = handlers.get(commandId);
      if (handler === undefined) {
        throw new Error(`Expected ${commandId} to be registered.`);
      }
      return handler();
    },
  };
  return harness;
}

function createStorage(initiallyPresent: boolean): TestStorage {
  const storage: TestStorage = {
    value: initiallyPresent ? "existing-test-api-key" : undefined,
    read: vi.fn(async (): Promise<string | undefined> => storage.value),
    save: vi.fn(async (apiKey: string) => {
      storage.value = apiKey;
    }),
    delete: vi.fn(async () => {
      storage.value = undefined;
    }),
  } satisfies TestStorage;
  return storage;
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
} {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (error: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve: resolvePromise,
    reject: rejectPromise,
  };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
