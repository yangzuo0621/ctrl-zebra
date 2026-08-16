import { describe, expect, it } from "vitest";

import {
  type ApprovalRequest,
  type ApprovalStateMessage,
  extensionToWebviewMessageSchema,
  type NewChatMessage,
  protocolEnvelopeSchema,
  protocolVersion,
  type ToolStateMessage,
  type WebviewToExtensionMessage,
  webviewToExtensionMessageSchema,
} from "./index.js";

const approval = {
  id: "approval-1",
  scope: {
    sessionId: "session-1",
    call: {
      id: "call-1",
      name: "propose_file_edit",
      input: { path: "src/example.ts", edits: [] },
    },
    risk: "write",
    workspaceRootUri: "file:///workspace",
    resources: [
      {
        uri: "file:///workspace/src/example.ts",
        revision: { kind: "document_version", value: 7 },
      },
    ],
  },
  presentation: {
    title: "Update example.ts",
    summary: "Replace one line in example.ts.",
  },
  createdAt: "2026-07-19T00:00:00.000Z",
  expiresAt: "2026-07-19T00:05:00.000Z",
} satisfies ApprovalRequest;

describe("Protocol envelope", () => {
  const validEnvelope = {
    protocolVersion,
    type: "webview/ping",
    requestId: "request-1",
  };

  it("round-trips a valid envelope through JSON", () => {
    expect(
      protocolEnvelopeSchema.parse(JSON.parse(JSON.stringify(validEnvelope)) as unknown),
    ).toEqual(validEnvelope);
  });

  it.each([
    { type: validEnvelope.type, requestId: validEnvelope.requestId },
    { protocolVersion, requestId: validEnvelope.requestId },
    { protocolVersion, type: validEnvelope.type },
  ])("rejects an envelope missing a required field %#", (envelope) => {
    expect(protocolEnvelopeSchema.safeParse(envelope).success).toBe(false);
  });

  it.each([
    { ...validEnvelope, protocolVersion: 2 },
    { ...validEnvelope, type: "" },
    { ...validEnvelope, type: "ping" },
    { ...validEnvelope, type: "webview/" },
    { ...validEnvelope, requestId: "" },
    { ...validEnvelope, requestId: "x".repeat(129) },
    { ...validEnvelope, unexpected: true },
  ])("rejects an invalid envelope %#", (envelope) => {
    expect(protocolEnvelopeSchema.safeParse(envelope).success).toBe(false);
  });
});

describe("Webview protocol messages", () => {
  it("round-trips valid ping and pong envelopes through JSON", () => {
    const ping = {
      protocolVersion,
      type: "webview/ping",
      requestId: "request-1",
    } satisfies WebviewToExtensionMessage;

    const parsedPing = webviewToExtensionMessageSchema.parse(
      JSON.parse(JSON.stringify(ping)) as unknown,
    );
    const pong = {
      protocolVersion,
      type: "extension/pong",
      requestId: parsedPing.requestId,
    };

    expect(parsedPing).toEqual(ping);
    expect(
      extensionToWebviewMessageSchema.parse(JSON.parse(JSON.stringify(pong)) as unknown),
    ).toEqual(pong);
  });

  it("round-trips an Extension-mediated approved external link", () => {
    const message = {
      protocolVersion,
      type: "webview/open-external-link",
      requestId: "link-1",
      href: "https://example.test/docs?q=markdown",
    } as const;

    expect(
      webviewToExtensionMessageSchema.parse(JSON.parse(JSON.stringify(message)) as unknown),
    ).toEqual(message);
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "file:///workspace/secret.txt",
    "//example.test/path",
    "https://example.test/with space",
    "https://example.test/\u0000",
    `https://example.test/${"x".repeat(2_049)}`,
  ])("rejects external links outside the HTTP(S) boundary: %s", (href) => {
    expect(
      webviewToExtensionMessageSchema.safeParse({
        protocolVersion,
        type: "webview/open-external-link",
        requestId: "link-invalid",
        href,
      }).success,
    ).toBe(false);
  });

  it("round-trips the strict Provider onboarding projection and action outcomes", () => {
    const statusRequest = {
      protocolVersion,
      type: "webview/provider-status",
      requestId: "provider-status-1",
    } as const;
    const saveKey = {
      protocolVersion,
      type: "webview/provider-save-key",
      requestId: "provider-save-1",
    } as const;
    const selectModel = {
      protocolVersion,
      type: "webview/provider-select-model",
      requestId: "provider-model-1",
    } as const;
    const openSettings = {
      protocolVersion,
      type: "webview/provider-open-settings",
      requestId: "provider-settings-1",
    } as const;
    const status = {
      protocolVersion,
      type: "extension/provider-status",
      requestId: statusRequest.requestId,
      provider: "gemini",
      apiKeyConfigured: false,
      modelConfigured: true,
    } as const;
    const completed = {
      protocolVersion,
      type: "extension/provider-action",
      requestId: saveKey.requestId,
      action: "save-key",
      status: "completed",
    } as const;
    const cancelled = {
      protocolVersion,
      type: "extension/provider-action",
      requestId: selectModel.requestId,
      action: "select-model",
      status: "cancelled",
    } as const;
    const failed = {
      protocolVersion,
      type: "extension/provider-action",
      requestId: openSettings.requestId,
      action: "open-settings",
      status: "failed",
      code: "internal",
      message: "The Provider action failed unexpectedly. Try again.",
    } as const;

    for (const request of [statusRequest, saveKey, selectModel, openSettings]) {
      expect(
        webviewToExtensionMessageSchema.parse(JSON.parse(JSON.stringify(request)) as unknown),
      ).toEqual(request);
    }
    for (const response of [status, completed, cancelled, failed]) {
      expect(
        extensionToWebviewMessageSchema.parse(JSON.parse(JSON.stringify(response)) as unknown),
      ).toEqual(response);
    }
  });

  it.each([
    { type: "webview/provider-status", requestId: "provider-1", extra: true },
    { type: "webview/provider-save-key", requestId: "provider-1", provider: "gemini" },
    { type: "webview/provider-select-model", requestId: "provider-1", action: "select-model" },
    {
      type: "webview/provider-open-settings",
      requestId: "provider-1",
      endpoint: "https://example.test",
    },
  ])("rejects Provider onboarding intents with unreviewed fields %#", (message) => {
    expect(webviewToExtensionMessageSchema.safeParse({ protocolVersion, ...message }).success).toBe(
      false,
    );
  });

  it.each([
    { provider: "anthropic" },
    { apiKeyConfigured: "false" },
    { modelConfigured: 1 },
    { unexpected: true },
  ])("rejects invalid Provider status projections %#", (override) => {
    expect(
      extensionToWebviewMessageSchema.safeParse({
        protocolVersion,
        type: "extension/provider-status",
        requestId: "provider-status-1",
        provider: "openai",
        apiKeyConfigured: true,
        modelConfigured: false,
        ...override,
      }).success,
    ).toBe(false);
  });

  it.each([
    { status: "completed", code: "internal" },
    { status: "cancelled", message: "should not be present" },
    { status: "failed", code: "unknown", message: "Safe failure." },
    { status: "failed", code: "internal", message: "" },
    { status: "failed", code: "internal", message: "x".repeat(257) },
    { status: "failed", code: "internal", message: "Safe failure.", extra: true },
  ])("rejects invalid Provider action outcomes %#", (override) => {
    expect(
      extensionToWebviewMessageSchema.safeParse({
        protocolVersion,
        type: "extension/provider-action",
        requestId: "provider-action-1",
        action: "save-key",
        ...override,
      }).success,
    ).toBe(false);
  });

  it("round-trips chat submission, cancellation, delta, and status messages", () => {
    const submit = {
      protocolVersion,
      type: "webview/submit",
      requestId: "request-2",
      content: "Say hello.",
    } as const;
    const cancel = {
      protocolVersion,
      type: "webview/cancel",
      requestId: "request-2",
    } as const;
    const delta = {
      protocolVersion,
      type: "extension/text-delta",
      requestId: "request-2",
      text: "Hel",
    } as const;
    const status = {
      protocolVersion,
      type: "extension/run-status",
      requestId: "request-2",
      status: "completed",
    } as const;
    const sessionStarted = {
      protocolVersion,
      type: "extension/session-started",
      requestId: "request-2",
      sessionId: "session-1",
    } as const;

    expect(webviewToExtensionMessageSchema.parse(submit)).toEqual(submit);
    expect(webviewToExtensionMessageSchema.parse(cancel)).toEqual(cancel);
    expect(extensionToWebviewMessageSchema.parse(delta)).toEqual(delta);
    expect(extensionToWebviewMessageSchema.parse(status)).toEqual(status);
    expect(
      extensionToWebviewMessageSchema.parse(JSON.parse(JSON.stringify(sessionStarted)) as unknown),
    ).toEqual(sessionStarted);

    const usage = {
      protocolVersion,
      type: "extension/token-usage",
      requestId: "request-2",
      usage: { inputTokens: 12, outputTokens: 4, totalTokens: 16 },
    } as const;
    expect(extensionToWebviewMessageSchema.parse(usage)).toEqual(usage);
  });

  it("round-trips a strictly target-bound regeneration command", () => {
    const regenerate = {
      protocolVersion,
      type: "webview/regenerate",
      requestId: "request-regenerate",
      sessionId: "session-1",
      messageId: "assistant-42",
    } as const;

    expect(
      webviewToExtensionMessageSchema.parse(JSON.parse(JSON.stringify(regenerate)) as unknown),
    ).toEqual(regenerate);
    expect(
      webviewToExtensionMessageSchema.safeParse({ ...regenerate, messageId: "" }).success,
    ).toBe(false);
    expect(
      webviewToExtensionMessageSchema.safeParse({ ...regenerate, unexpected: true }).success,
    ).toBe(false);
    expect(extensionToWebviewMessageSchema.safeParse(regenerate).success).toBe(false);
  });

  it("round-trips a strictly target-bound edit command", () => {
    const edit = {
      protocolVersion,
      type: "webview/edit-message",
      requestId: "request-edit",
      sessionId: "session-1",
      messageId: "message-42",
      content: "Use the revised question.",
    } as const;

    expect(
      webviewToExtensionMessageSchema.parse(JSON.parse(JSON.stringify(edit)) as unknown),
    ).toEqual(edit);
    expect(webviewToExtensionMessageSchema.safeParse({ ...edit, content: "   " }).success).toBe(
      false,
    );
    expect(
      webviewToExtensionMessageSchema.safeParse({ ...edit, content: "x".repeat(1_000_001) })
        .success,
    ).toBe(false);
    expect(webviewToExtensionMessageSchema.safeParse({ ...edit, unexpected: true }).success).toBe(
      false,
    );
    expect(extensionToWebviewMessageSchema.safeParse(edit).success).toBe(false);
  });

  describe("multi-turn Session commands", () => {
    const legacySubmit = {
      protocolVersion,
      type: "webview/submit",
      requestId: "request-legacy",
      content: "Continue the existing conversation.",
    } as const;
    const continuedSubmit = {
      ...legacySubmit,
      requestId: "request-continued",
      sessionId: "session-1",
    } as const;
    const newChat = {
      protocolVersion,
      type: "webview/new-chat",
      requestId: "request-new-chat",
    } satisfies NewChatMessage;

    it("accepts legacy and continued submits and round-trips them through JSON", () => {
      expect(
        webviewToExtensionMessageSchema.parse(JSON.parse(JSON.stringify(legacySubmit)) as unknown),
      ).toEqual(legacySubmit);
      expect(
        webviewToExtensionMessageSchema.parse(
          JSON.parse(JSON.stringify(continuedSubmit)) as unknown,
        ),
      ).toEqual(continuedSubmit);
    });

    it("accepts the strict envelope-only New chat command and round-trips it through JSON", () => {
      expect(
        webviewToExtensionMessageSchema.parse(JSON.parse(JSON.stringify(newChat)) as unknown),
      ).toEqual(newChat);
    });

    it.each([
      { ...continuedSubmit, sessionId: null },
      { ...continuedSubmit, sessionId: "" },
      { ...continuedSubmit, sessionId: "x".repeat(129) },
      { ...continuedSubmit, sessionId: 42 },
      { ...continuedSubmit, unexpected: true },
      { ...newChat, sessionId: "session-1" },
      { ...newChat, unexpected: true },
    ])("rejects invalid Session command fields %#", (message) => {
      expect(webviewToExtensionMessageSchema.safeParse(message).success).toBe(false);
    });

    it("keeps New chat Webview-only and rejects it in the opposite direction", () => {
      expect(extensionToWebviewMessageSchema.safeParse(newChat).success).toBe(false);
      expect(
        webviewToExtensionMessageSchema.safeParse({
          ...newChat,
          type: "extension/new-chat",
        }).success,
      ).toBe(false);
    });

    it("accepts content and identifier limits and rejects one character beyond each limit", () => {
      const maxContent = "x".repeat(1_000_000);
      const maxRequestId = "r".repeat(128);
      const maxSessionId = "s".repeat(128);
      const atLimits = {
        protocolVersion,
        type: "webview/submit",
        requestId: maxRequestId,
        content: maxContent,
        sessionId: maxSessionId,
      } as const;

      expect(webviewToExtensionMessageSchema.safeParse(atLimits).success).toBe(true);
      expect(
        webviewToExtensionMessageSchema.safeParse({
          ...atLimits,
          content: `${maxContent}x`,
        }).success,
      ).toBe(false);
      expect(
        webviewToExtensionMessageSchema.safeParse({
          ...atLimits,
          requestId: `${maxRequestId}x`,
        }).success,
      ).toBe(false);
      expect(
        webviewToExtensionMessageSchema.safeParse({
          ...atLimits,
          sessionId: `${maxSessionId}x`,
        }).success,
      ).toBe(false);
    });

    it("keeps protocol version 1 submit compatibility when sessionId is omitted", () => {
      expect(protocolVersion).toBe(1);
      expect(webviewToExtensionMessageSchema.parse(legacySubmit)).toEqual(legacySubmit);
      expect("sessionId" in legacySubmit).toBe(false);
    });
  });

  it.each([
    "configuration",
    "authentication",
    "network",
    "rate-limit",
    "context",
    "tool",
    "internal",
  ] as const)("round-trips the %s run error category", (code) => {
    const message = {
      protocolVersion,
      type: "extension/run-error",
      requestId: "request-error",
      code,
      message: `Safe ${code} guidance.`,
    } as const;

    expect(extensionToWebviewMessageSchema.parse(message)).toEqual(message);
  });

  it.each([
    { code: "unknown" },
    { message: "" },
    { message: "x".repeat(257) },
    { unexpected: true },
  ])("rejects an invalid run error payload %#", (override) => {
    expect(
      extensionToWebviewMessageSchema.safeParse({
        protocolVersion,
        type: "extension/run-error",
        requestId: "request-error",
        code: "internal",
        message: "Safe guidance.",
        ...override,
      }).success,
    ).toBe(false);
  });

  it("round-trips Session list and restore messages", () => {
    const listRequest = {
      protocolVersion,
      type: "webview/list-sessions",
      requestId: "list-1",
    } as const;
    const restoreRequest = {
      protocolVersion,
      type: "webview/restore-session",
      requestId: "restore-1",
      sessionId: "session-1",
    } as const;
    const listResponse = {
      protocolVersion,
      type: "extension/session-list",
      requestId: "list-1",
      sessions: [
        {
          sessionId: "session-1",
          status: "completed",
          createdAt: "2026-07-19T10:00:00.000Z",
        },
      ],
    } as const;

    expect(webviewToExtensionMessageSchema.parse(listRequest)).toEqual(listRequest);
    expect(webviewToExtensionMessageSchema.parse(restoreRequest)).toEqual(restoreRequest);
    expect(extensionToWebviewMessageSchema.parse(listResponse)).toEqual(listResponse);
  });

  it.each([
    {
      protocolVersion,
      type: "extension/tool-state",
      requestId: "request-tool",
      call: { id: "call-1", name: "read_file", input: { path: "README.md" } },
      source: { kind: "builtin" },
      status: "pending",
    },
    {
      protocolVersion,
      type: "extension/tool-state",
      requestId: "request-tool",
      call: { id: "call-1", name: "read_file", input: { path: "README.md" } },
      source: { kind: "builtin" },
      status: "running",
    },
    {
      protocolVersion,
      type: "extension/tool-state",
      requestId: "request-tool",
      call: { id: "call-1", name: "read_file", input: { path: "README.md" } },
      source: { kind: "builtin" },
      status: "success",
      result: {
        callId: "call-1",
        name: "read_file",
        status: "success",
        output: { content: "hello" },
        truncated: false,
      },
    },
    {
      protocolVersion,
      type: "extension/tool-state",
      requestId: "request-tool",
      call: { id: "call-1", name: "read_file", input: { path: "README.md" } },
      source: { kind: "builtin" },
      status: "error",
      result: {
        callId: "call-1",
        name: "read_file",
        status: "error",
        error: { code: "failed", message: "Safe failure." },
      },
    },
  ] satisfies readonly ToolStateMessage[])("round-trips the $status Tool Call state", (message) => {
    expect(
      extensionToWebviewMessageSchema.parse(JSON.parse(JSON.stringify(message)) as unknown),
    ).toEqual(message);
  });

  it("round-trips Approval state and minimal Webview Approval actions", () => {
    const state = {
      protocolVersion,
      type: "extension/approval-state",
      requestId: "request-approval",
      approval,
      status: "pending",
    } satisfies ApprovalStateMessage;
    const showDiff = {
      protocolVersion,
      type: "webview/show-approval-diff",
      requestId: state.requestId,
      approvalId: approval.id,
    } as const;
    const approve = {
      protocolVersion,
      type: "webview/approval-decision",
      requestId: state.requestId,
      approvalId: approval.id,
      decision: "approved",
    } as const;

    expect(
      extensionToWebviewMessageSchema.parse(JSON.parse(JSON.stringify(state)) as unknown),
    ).toEqual(state);
    expect(webviewToExtensionMessageSchema.parse(showDiff)).toEqual(showDiff);
    expect(webviewToExtensionMessageSchema.parse(approve)).toEqual(approve);
  });

  it.each([
    {
      protocolVersion,
      type: "webview/approval-decision",
      requestId: "request-approval",
      approvalId: approval.id,
      decision: "cancelled",
    },
    {
      protocolVersion,
      type: "webview/approval-decision",
      requestId: "request-approval",
      approvalId: approval.id,
      decision: "approved",
      decidedAt: "2026-07-19T00:01:00.000Z",
    },
    {
      protocolVersion,
      type: "webview/show-approval-diff",
      requestId: "request-approval",
      approvalId: "",
    },
  ])("rejects an unsafe Webview Approval action %#", (message) => {
    expect(webviewToExtensionMessageSchema.safeParse(message).success).toBe(false);
  });

  it.each([
    null,
    {},
    { protocolVersion, type: "webview/ping" },
    { protocolVersion: 2, type: "webview/ping", requestId: "request-1" },
    { protocolVersion, type: "webview/unknown", requestId: "request-1" },
    { protocolVersion, type: "webview/ping", requestId: "" },
    { protocolVersion, type: "webview/ping", requestId: "request-1", unexpected: true },
    { protocolVersion, type: "webview/submit", requestId: "request-1", content: "   " },
    { protocolVersion, type: "webview/submit", requestId: "request-1", content: "x", extra: true },
    { protocolVersion, type: "webview/cancel", requestId: "request-1", content: "x" },
  ])("rejects invalid Webview input %#", (message) => {
    expect(webviewToExtensionMessageSchema.safeParse(message).success).toBe(false);
  });

  it("rejects a message sent in the wrong direction", () => {
    expect(
      webviewToExtensionMessageSchema.safeParse({
        protocolVersion,
        type: "extension/pong",
        requestId: "request-1",
      }).success,
    ).toBe(false);
  });

  it("rejects invalid Extension streaming events", () => {
    expect(
      extensionToWebviewMessageSchema.safeParse({
        protocolVersion,
        type: "extension/text-delta",
        requestId: "request-1",
        text: "",
      }).success,
    ).toBe(false);
    expect(
      extensionToWebviewMessageSchema.safeParse({
        protocolVersion,
        type: "extension/run-status",
        requestId: "request-1",
        status: "idle",
      }).success,
    ).toBe(false);
    expect(
      extensionToWebviewMessageSchema.safeParse({
        protocolVersion,
        type: "extension/session-started",
        requestId: "request-1",
        sessionId: "",
      }).success,
    ).toBe(false);
    expect(
      extensionToWebviewMessageSchema.safeParse({
        protocolVersion,
        type: "extension/session-started",
        requestId: "request-1",
        sessionId: "session-1",
        extra: true,
      }).success,
    ).toBe(false);
    expect(
      extensionToWebviewMessageSchema.safeParse({
        protocolVersion,
        type: "extension/tool-state",
        requestId: "request-1",
        call: { id: "call-1", name: "read_file", input: {} },
        status: "success",
      }).success,
    ).toBe(false);
    expect(
      extensionToWebviewMessageSchema.safeParse({
        protocolVersion,
        type: "extension/token-usage",
        requestId: "request-1",
        usage: { inputTokens: -1 },
      }).success,
    ).toBe(false);
  });

  it("round-trips strict Session deletion intents and bounded outcomes", () => {
    const deleteMessage = {
      protocolVersion,
      type: "webview/delete-session",
      requestId: "delete-1",
      sessionId: "session-1",
    } as const;
    const clearMessage = {
      protocolVersion,
      type: "webview/clear-sessions",
      requestId: "clear-1",
      confirm: true,
    } as const;
    const deleted = {
      protocolVersion,
      type: "extension/session-deleted",
      requestId: deleteMessage.requestId,
      sessionId: deleteMessage.sessionId,
    } as const;
    const cleared = {
      protocolVersion,
      type: "extension/sessions-cleared",
      requestId: clearMessage.requestId,
      deletedCount: 2,
    } as const;

    expect(webviewToExtensionMessageSchema.parse(deleteMessage)).toEqual(deleteMessage);
    expect(webviewToExtensionMessageSchema.parse(clearMessage)).toEqual(clearMessage);
    expect(extensionToWebviewMessageSchema.parse(deleted)).toEqual(deleted);
    expect(extensionToWebviewMessageSchema.parse(cleared)).toEqual(cleared);
    expect(
      webviewToExtensionMessageSchema.safeParse({ ...clearMessage, confirm: false }).success,
    ).toBe(false);
    expect(
      extensionToWebviewMessageSchema.safeParse({
        protocolVersion,
        type: "extension/sessions-cleared",
        requestId: "clear-1",
        deletedCount: -1,
      }).success,
    ).toBe(false);
  });

  it("round-trips the high-risk local-data clear contract with category reports", () => {
    const request = {
      protocolVersion,
      type: "webview/clear-local-data",
      requestId: "clear-local-data-1",
      confirm: true,
    } as const;
    const result = {
      protocolVersion,
      type: "extension/local-data-clear-result",
      requestId: request.requestId,
      outcome: "partial",
      categories: [
        {
          category: "running-operations",
          outcome: "cleared",
          deleted: 0,
          failed: 0,
        },
        {
          category: "provider-secret",
          outcome: "failed",
          deleted: 2,
          failed: 1,
        },
      ],
      message: "Some CtrlZebra local data could not be cleared. Retry to continue.",
    } as const;

    expect(webviewToExtensionMessageSchema.parse(request)).toEqual(request);
    expect(extensionToWebviewMessageSchema.parse(result)).toEqual(result);
    expect(webviewToExtensionMessageSchema.safeParse({ ...request, confirm: false }).success).toBe(
      false,
    );
    expect(
      extensionToWebviewMessageSchema.safeParse({
        ...result,
        categories: [
          {
            category: "unknown",
            outcome: "failed",
            deleted: 0,
            failed: 1,
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("accepts only an opaque selected Session intent", () => {
    const selected = {
      protocolVersion,
      type: "webview/select-session",
      requestId: "select-1",
      sessionId: "session-1",
    } as const;
    const cleared = {
      protocolVersion,
      type: "webview/select-session",
      requestId: "select-2",
    } as const;

    expect(webviewToExtensionMessageSchema.parse(selected)).toEqual(selected);
    expect(webviewToExtensionMessageSchema.parse(cleared)).toEqual(cleared);
    expect(webviewToExtensionMessageSchema.safeParse({ ...selected, sessionId: "" }).success).toBe(
      false,
    );
  });
});
