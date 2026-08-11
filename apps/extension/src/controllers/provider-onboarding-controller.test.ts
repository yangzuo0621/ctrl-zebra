import { type ExtensionToWebviewMessage, protocolVersion } from "@ctrl-zebra/protocol";
import { describe, expect, it, vi } from "vitest";

import { ProviderOnboardingController } from "./provider-onboarding-controller.js";

const readyStatus = {
  provider: "openai" as const,
  apiKeyConfigured: true,
  modelConfigured: true,
};

describe("ProviderOnboardingController", () => {
  it("publishes a bounded status projection", async () => {
    const post = vi.fn<(message: ExtensionToWebviewMessage) => void>();
    const controller = new ProviderOnboardingController({
      readStatus: async () => readyStatus,
      run: async () => ({ status: "completed" }),
    });

    await controller.status("status-1", post);

    expect(post).toHaveBeenCalledWith({
      protocolVersion,
      type: "extension/provider-status",
      requestId: "status-1",
      ...readyStatus,
    });
  });

  it("settles an action before publishing the correlated fresh status", async () => {
    const post = vi.fn<(message: ExtensionToWebviewMessage) => void>();
    const controller = new ProviderOnboardingController({
      readStatus: async () => ({ ...readyStatus, apiKeyConfigured: false }),
      run: async () => ({ status: "failed", code: "storage" }),
    });

    await controller.action("action-1", "save-key", post);

    expect(post.mock.calls.map(([message]) => message.type)).toEqual([
      "extension/provider-action",
      "extension/provider-status",
    ]);
    expect(post.mock.calls[0]?.[0]).toEqual({
      protocolVersion,
      type: "extension/provider-action",
      requestId: "action-1",
      action: "save-key",
      status: "failed",
      code: "storage",
      message: "The Provider setting could not be saved. Try again.",
    });
    expect(post.mock.calls[1]?.[0]).toEqual({
      protocolVersion,
      type: "extension/provider-status",
      requestId: "action-1",
      provider: "openai",
      apiKeyConfigured: false,
      modelConfigured: true,
    });
  });

  it("serializes actions and suppresses responses after disposal", async () => {
    let resolveAction: ((result: { status: "cancelled" }) => void) | undefined;
    const post = vi.fn<(message: ExtensionToWebviewMessage) => void>();
    const controller = new ProviderOnboardingController({
      readStatus: async () => readyStatus,
      run: () =>
        new Promise((resolve) => {
          resolveAction = resolve;
        }),
    });

    const firstAction = controller.action("action-1", "select-model", post);
    await Promise.resolve();
    await controller.action("action-2", "open-settings", post);
    expect(post).not.toHaveBeenCalled();

    controller.dispose();
    resolveAction?.({ status: "cancelled" });
    await firstAction;
    expect(post).not.toHaveBeenCalled();
  });

  it("converts unexpected action failures to a safe internal outcome", async () => {
    const post = vi.fn<(message: ExtensionToWebviewMessage) => void>();
    const controller = new ProviderOnboardingController({
      readStatus: async () => readyStatus,
      run: async () => {
        throw new Error("private host detail");
      },
    });

    await controller.action("action-1", "open-settings", post);

    expect(post.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        status: "failed",
        code: "internal",
        message: "The Provider action failed unexpectedly. Try again.",
      }),
    );
  });
});
