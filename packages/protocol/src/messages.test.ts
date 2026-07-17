import { describe, expect, it } from "vitest";

import {
  extensionToWebviewMessageSchema,
  protocolEnvelopeSchema,
  protocolVersion,
  type ToolStateMessage,
  type WebviewToExtensionMessage,
  webviewToExtensionMessageSchema,
} from "./index.js";

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
