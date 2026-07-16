import { describe, expect, it } from "vitest";

import {
  extensionToWebviewMessageSchema,
  protocolEnvelopeSchema,
  protocolVersion,
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
  });
});
