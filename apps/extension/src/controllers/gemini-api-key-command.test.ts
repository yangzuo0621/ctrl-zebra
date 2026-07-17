import { describe, expect, it, vi } from "vitest";
import type { Disposable, InputBoxOptions } from "vscode";

import {
  type ApiKeySecretStorage,
  ApiKeySecretStorageError,
} from "../adapters/api-key-secret-storage.js";
import {
  registerGeminiApiKeyCommand,
  saveGeminiApiKeyCommandId,
} from "./gemini-api-key-command.js";

describe("Gemini API key command", () => {
  it("registers the stable command and stores the exact password-masked input", async () => {
    const harness = createHarness(" test-gemini-api-key ");

    const registration = registerGeminiApiKeyCommand(harness.options);
    await harness.runHandler();

    expect(registration).toBe(harness.disposable);
    expect(harness.registerCommand).toHaveBeenCalledWith(
      saveGeminiApiKeyCommandId,
      expect.any(Function),
    );
    expect(harness.showInputBox).toHaveBeenCalledWith({
      ignoreFocusOut: true,
      password: true,
      prompt: "Enter the Google Gemini API key to store securely on this machine.",
      title: "CtrlZebra: Save Gemini API Key",
      validateInput: expect.any(Function),
    });
    expect(harness.storage.save).toHaveBeenCalledWith(" test-gemini-api-key ");
    expect(harness.showInformationMessage).toHaveBeenCalledWith("Gemini API key saved securely.");
    expect(harness.showErrorMessage).not.toHaveBeenCalled();
  });

  it("cancels without writing or reporting success", async () => {
    const harness = createHarness(undefined);

    registerGeminiApiKeyCommand(harness.options);
    await harness.runHandler();

    expect(harness.storage.save).not.toHaveBeenCalled();
    expect(harness.showInformationMessage).not.toHaveBeenCalled();
    expect(harness.showErrorMessage).not.toHaveBeenCalled();
  });

  it("rejects an empty result even when the host bypasses input validation", async () => {
    const harness = createHarness("");

    registerGeminiApiKeyCommand(harness.options);
    await harness.runHandler();

    const inputOptions = harness.showInputBox.mock.calls[0]?.[0];
    expect(await inputOptions?.validateInput?.("")).toBe("Enter a non-empty Gemini API key.");
    expect(await inputOptions?.validateInput?.("test-gemini-api-key")).toBeUndefined();
    expect(harness.storage.save).not.toHaveBeenCalled();
    expect(harness.showErrorMessage).toHaveBeenCalledWith("Enter a non-empty Gemini API key.");
  });

  it("shows only the safe mapped storage failure", async () => {
    const harness = createHarness("test-gemini-api-key");
    harness.storage.save.mockRejectedValue(new ApiKeySecretStorageError("save"));

    registerGeminiApiKeyCommand(harness.options);
    await harness.runHandler();

    expect(harness.showErrorMessage).toHaveBeenCalledWith("Unable to save the API key.");
    expect(harness.showInformationMessage).not.toHaveBeenCalled();
    expect(String(harness.showErrorMessage.mock.calls)).not.toContain("test-gemini-api-key");
  });

  it("propagates an unexpected failure without presenting its message", async () => {
    const harness = createHarness("test-gemini-api-key");
    const unexpected = new Error("unexpected failure containing test-gemini-api-key");
    harness.storage.save.mockRejectedValue(unexpected);

    registerGeminiApiKeyCommand(harness.options);

    await expect(harness.runHandler()).rejects.toBe(unexpected);
    expect(harness.showErrorMessage).not.toHaveBeenCalled();
    expect(harness.showInformationMessage).not.toHaveBeenCalled();
  });
});

function createHarness(input: string | undefined) {
  const disposable: Disposable = { dispose: vi.fn() };
  const storage = {
    read: vi.fn(),
    save: vi.fn(),
    delete: vi.fn(),
  } satisfies ApiKeySecretStorage;
  let handler: (() => Promise<void>) | undefined;
  const registerCommand = vi.fn((_: string, commandHandler: () => Promise<void>) => {
    handler = commandHandler;
    return disposable;
  });
  const showInputBox = vi.fn(async (_: InputBoxOptions) => input);
  const showInformationMessage = vi.fn(async (_: string) => undefined);
  const showErrorMessage = vi.fn(async (_: string) => undefined);

  return {
    disposable,
    storage,
    registerCommand,
    showInputBox,
    showInformationMessage,
    showErrorMessage,
    options: {
      storage,
      registerCommand,
      showInputBox,
      showInformationMessage,
      showErrorMessage,
    },
    async runHandler() {
      if (handler === undefined) {
        throw new Error("Expected the command handler to be registered.");
      }
      await handler();
    },
  };
}
