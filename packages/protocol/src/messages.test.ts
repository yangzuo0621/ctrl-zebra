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

  it.each([
    null,
    {},
    { protocolVersion, type: "webview/ping" },
    { protocolVersion: 2, type: "webview/ping", requestId: "request-1" },
    { protocolVersion, type: "webview/unknown", requestId: "request-1" },
    { protocolVersion, type: "webview/ping", requestId: "" },
    { protocolVersion, type: "webview/ping", requestId: "request-1", unexpected: true },
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
});
