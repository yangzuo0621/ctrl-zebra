import { describe, expect, it } from "vitest";

import {
  type ApprovalRequest,
  type ApprovalStateMessage,
  extensionToWebviewMessageSchema,
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

    expect(webviewToExtensionMessageSchema.parse(submit)).toEqual(submit);
    expect(webviewToExtensionMessageSchema.parse(cancel)).toEqual(cancel);
    expect(extensionToWebviewMessageSchema.parse(delta)).toEqual(delta);
    expect(extensionToWebviewMessageSchema.parse(status)).toEqual(status);
  });

  it.each([
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
      status: "pending",
    },
    {
      protocolVersion,
      type: "extension/tool-state",
      requestId: "request-tool",
      call: { id: "call-1", name: "read_file", input: { path: "README.md" } },
      status: "running",
    },
    {
      protocolVersion,
      type: "extension/tool-state",
      requestId: "request-tool",
      call: { id: "call-1", name: "read_file", input: { path: "README.md" } },
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
        type: "extension/tool-state",
        requestId: "request-1",
        call: { id: "call-1", name: "read_file", input: {} },
        status: "success",
      }).success,
    ).toBe(false);
  });
});
