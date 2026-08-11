import { protocolVersion, type WebviewToExtensionMessage } from "@ctrl-zebra/protocol";
import { describe, expect, it } from "vitest";

import { createOnboardingStore } from "./onboarding-store.js";
import type { WebviewHost } from "./vscode-api.js";

function createHost(sent: WebviewToExtensionMessage[]): WebviewHost {
  return {
    requestProviderStatus: (requestId: string) =>
      sent.push({ protocolVersion, type: "webview/provider-status", requestId }),
    saveProviderKey: (requestId: string) =>
      sent.push({ protocolVersion, type: "webview/provider-save-key", requestId }),
    selectProviderModel: (requestId: string) =>
      sent.push({ protocolVersion, type: "webview/provider-select-model", requestId }),
    openProviderSettings: (requestId: string) =>
      sent.push({ protocolVersion, type: "webview/provider-open-settings", requestId }),
  } as unknown as WebviewHost;
}

describe("Provider onboarding store", () => {
  it("accepts all provider status projections only for the active request", () => {
    const sent: WebviewToExtensionMessage[] = [];
    const store = createOnboardingStore(createHost(sent), () => "status-1");

    expect(store.getState().refresh()).toBe(true);
    store.getState().receive({
      protocolVersion,
      type: "extension/provider-status",
      requestId: "stale",
      provider: "gemini",
      apiKeyConfigured: true,
      modelConfigured: true,
    });
    expect(store.getState().status).toBeUndefined();

    store.getState().receive({
      protocolVersion,
      type: "extension/provider-status",
      requestId: "status-1",
      provider: "gemini",
      apiKeyConfigured: true,
      modelConfigured: false,
    });
    expect(store.getState().status).toMatchObject({
      provider: "gemini",
      apiKeyConfigured: true,
      modelConfigured: false,
    });
    expect(sent).toEqual([
      { protocolVersion, type: "webview/provider-status", requestId: "status-1" },
    ]);
  });

  it("requires a matching terminal action before accepting its fresh status", () => {
    const sent: WebviewToExtensionMessage[] = [];
    const ids = ["action-1", "status-2"];
    const store = createOnboardingStore(createHost(sent), () => ids.shift() ?? "unexpected");

    expect(store.getState().runAction("save-key")).toBe(true);
    store.getState().receive({
      protocolVersion,
      type: "extension/provider-status",
      requestId: "action-1",
      provider: "openai",
      apiKeyConfigured: true,
      modelConfigured: false,
    });
    expect(store.getState().status).toBeUndefined();

    store.getState().receive({
      protocolVersion,
      type: "extension/provider-action",
      requestId: "action-1",
      action: "save-key",
      status: "completed",
    });
    expect(store.getState().pendingAction).toBeUndefined();
    expect(store.getState().announcement).toBe("Save API key completed.");

    store.getState().receive({
      protocolVersion,
      type: "extension/provider-status",
      requestId: "action-1",
      provider: "openai",
      apiKeyConfigured: true,
      modelConfigured: false,
    });
    expect(store.getState().status?.apiKeyConfigured).toBe(true);
  });

  it("ignores mismatched outcomes and blocks duplicate actions while pending", () => {
    const sent: WebviewToExtensionMessage[] = [];
    const store = createOnboardingStore(createHost(sent), () => "action-1");

    expect(store.getState().runAction("select-model")).toBe(true);
    expect(store.getState().runAction("open-settings")).toBe(false);
    store.getState().receive({
      protocolVersion,
      type: "extension/provider-action",
      requestId: "other",
      action: "select-model",
      status: "cancelled",
    });
    expect(store.getState().pendingAction?.requestId).toBe("action-1");
  });

  it("announces fixed safe failure text and suppresses disposed updates", () => {
    const sent: WebviewToExtensionMessage[] = [];
    const store = createOnboardingStore(createHost(sent), () => "action-1");

    store.getState().runAction("open-settings");
    store.getState().receive({
      protocolVersion,
      type: "extension/provider-action",
      requestId: "action-1",
      action: "open-settings",
      status: "failed",
      code: "internal",
      message: "host detail must not be rendered",
    });
    expect(store.getState().announcement).toBe("Open Provider settings failed. Try again.");
    store.getState().dispose();
    store.getState().receive({
      protocolVersion,
      type: "extension/provider-status",
      requestId: "action-1",
      provider: "openai",
      apiKeyConfigured: true,
      modelConfigured: true,
    });
    expect(store.getState().status).toBeUndefined();
  });
});
