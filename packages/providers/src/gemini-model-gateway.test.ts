import type { ModelEvent, ModelGatewayErrorCode } from "@ctrl-zebra/core";
import { APICallError, InvalidResponseDataError, LoadAPIKeyError } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createGeminiModelGateway } from "./gemini-model-gateway.js";

const sdkMocks = vi.hoisted(() => ({
  createGoogleGenerativeAI: vi.fn(),
  streamText: vi.fn(),
}));

vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: sdkMocks.createGoogleGenerativeAI,
}));
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, streamText: sdkMocks.streamText };
});

const request = {
  messages: [
    { role: "system", content: "Be concise." },
    { role: "user", content: "Say hello." },
  ],
} as const;

describe("Gemini ModelGateway", () => {
  const model = { modelId: "test-model" };
  const selectModel = vi.fn(() => model);

  beforeEach(() => {
    sdkMocks.createGoogleGenerativeAI.mockReset();
    sdkMocks.streamText.mockReset();
    selectModel.mockClear();
    sdkMocks.createGoogleGenerativeAI.mockReturnValue(selectModel);
  });

  it("maps SDK stream parts to Core events in source order", async () => {
    setStreamParts([
      { type: "start" },
      { type: "text-start", id: "text-1" },
      { type: "text-delta", id: "text-1", text: "Hel" },
      {
        type: "tool-call",
        toolCallId: "call-1",
        toolName: "lookup",
        input: { query: "zebra" },
      },
      { type: "text-delta", id: "text-1", text: "lo" },
      {
        type: "finish",
        finishReason: "stop",
        totalUsage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 },
      },
    ]);
    const signal = new AbortController().signal;
    const gateway = createGeminiModelGateway({
      apiKey: "test-gemini-api-key",
      modelId: "gemini-test",
    });

    await expect(collectEvents(gateway.stream(request, signal))).resolves.toEqual([
      { type: "text.delta", text: "Hel" },
      {
        type: "tool.call",
        call: { id: "call-1", name: "lookup", input: { query: "zebra" } },
      },
      { type: "text.delta", text: "lo" },
      { type: "usage", usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 } },
      { type: "finish", reason: "stop" },
    ]);
    expect(sdkMocks.createGoogleGenerativeAI).toHaveBeenCalledWith({
      apiKey: "test-gemini-api-key",
      baseURL: undefined,
      fetch: expect.any(Function),
    });
    expect(selectModel).toHaveBeenCalledWith("gemini-test");
    expect(sdkMocks.streamText).toHaveBeenCalledWith({
      abortSignal: signal,
      maxRetries: 0,
      messages: request.messages,
      model,
    });
  });

  it("passes a validated custom endpoint to the dedicated Provider", () => {
    createGeminiModelGateway({
      apiKey: "test-gemini-api-key",
      modelId: "gemini-test",
      baseURL: "https://models.example.test/v1beta",
    });

    expect(sdkMocks.createGoogleGenerativeAI).toHaveBeenCalledWith({
      apiKey: "test-gemini-api-key",
      baseURL: "https://models.example.test/v1beta",
      fetch: expect.any(Function),
    });
  });

  it("rejects endpoint redirects while preserving request options", async () => {
    createGeminiModelGateway({ apiKey: "test-gemini-api-key", modelId: "gemini-test" });
    const providerOptions = sdkMocks.createGoogleGenerativeAI.mock.calls[0]?.[0];
    const providerFetch = providerOptions?.fetch;
    const signal = new AbortController().signal;
    const response = new Response(null, { status: 204 });
    const fetchMock = vi.fn(async () => response);
    vi.stubGlobal("fetch", fetchMock);

    try {
      await expect(
        providerFetch?.("https://models.example.test/v1beta", {
          headers: { "x-test": "value" },
          signal,
        }),
      ).resolves.toBe(response);
      expect(fetchMock).toHaveBeenCalledWith("https://models.example.test/v1beta", {
        headers: { "x-test": "value" },
        signal,
        redirect: "error",
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("preserves missing token counts and maps the SDK error finish reason", async () => {
    setStreamParts([
      {
        type: "finish",
        finishReason: "error",
        totalUsage: { inputTokens: undefined, outputTokens: undefined, totalTokens: undefined },
      },
    ]);
    const gateway = createGeminiModelGateway({
      apiKey: "test-gemini-api-key",
      modelId: "gemini-test",
    });

    await expect(
      collectEvents(gateway.stream(request, new AbortController().signal)),
    ).resolves.toEqual([
      {
        type: "usage",
        usage: { inputTokens: undefined, outputTokens: undefined, totalTokens: undefined },
      },
      { type: "finish", reason: "other" },
    ]);
  });

  it.each([
    [401, false, "authentication"],
    [403, false, "authentication"],
    [429, true, "rate-limit"],
    [400, false, "invalid-request"],
    [408, true, "unavailable"],
    [503, true, "unavailable"],
    [undefined, false, "unknown"],
  ] as const)("maps API status %s to %s", async (statusCode, isRetryable, expectedCode) => {
    sdkMocks.streamText.mockImplementation(() => {
      throw new APICallError({
        isRetryable,
        message: "provider failure",
        requestBodyValues: {},
        statusCode,
        url: "https://example.invalid",
      });
    });
    const gateway = createGeminiModelGateway({
      apiKey: "test-gemini-api-key",
      modelId: "gemini-test",
    });

    await expect(
      collectEvents(gateway.stream(request, new AbortController().signal)),
    ).rejects.toMatchObject({ code: expectedCode });
  });

  it.each([
    [new LoadAPIKeyError({ message: "missing key" }), "authentication"],
    [new InvalidResponseDataError({ data: null }), "malformed-response"],
  ] as const)("maps typed SDK failures without inspecting their messages", async (failure, expectedCode) => {
    setStreamParts([{ type: "error", error: failure }]);
    const gateway = createGeminiModelGateway({
      apiKey: "test-gemini-api-key",
      modelId: "gemini-test",
    });

    await expect(
      collectEvents(gateway.stream(request, new AbortController().signal)),
    ).rejects.toMatchObject({ code: expectedCode satisfies ModelGatewayErrorCode });
  });

  it("rejects malformed SDK parts at the Provider boundary", async () => {
    setStreamParts([
      {
        type: "finish",
        finishReason: "stop",
        totalUsage: { inputTokens: -1, outputTokens: 2, totalTokens: 1 },
      },
    ]);
    const gateway = createGeminiModelGateway({
      apiKey: "test-gemini-api-key",
      modelId: "gemini-test",
    });

    await expect(
      collectEvents(gateway.stream(request, new AbortController().signal)),
    ).rejects.toMatchObject({ code: "malformed-response" });
  });

  it("forwards cancellation and emits no later events", async () => {
    setStreamParts([
      { type: "text-delta", id: "text-1", text: "before" },
      { type: "text-delta", id: "text-1", text: "after" },
    ]);
    const cancellation = new Error("cancelled by test");
    const controller = new AbortController();
    const gateway = createGeminiModelGateway({
      apiKey: "test-gemini-api-key",
      modelId: "gemini-test",
    });
    const events: ModelEvent[] = [];

    const consume = async () => {
      for await (const event of gateway.stream(request, controller.signal)) {
        events.push(event);
        controller.abort(cancellation);
      }
    };

    await expect(consume()).rejects.toBe(cancellation);
    expect(events).toEqual([{ type: "text.delta", text: "before" }]);
    expect(sdkMocks.streamText).toHaveBeenCalledWith(
      expect.objectContaining({ abortSignal: controller.signal }),
    );
  });

  it("does not start the SDK when already cancelled", async () => {
    const cancellation = new Error("cancelled before start");
    const controller = new AbortController();
    controller.abort(cancellation);
    const gateway = createGeminiModelGateway({
      apiKey: "test-gemini-api-key",
      modelId: "gemini-test",
    });

    await expect(collectEvents(gateway.stream(request, controller.signal))).rejects.toBe(
      cancellation,
    );
    expect(sdkMocks.streamText).not.toHaveBeenCalled();
  });
});

function setStreamParts(parts: readonly unknown[]): void {
  sdkMocks.streamText.mockReturnValue({ fullStream: streamParts(parts) });
}

async function* streamParts(parts: readonly unknown[]): AsyncIterable<unknown> {
  yield* parts;
}

async function collectEvents(events: AsyncIterable<ModelEvent>): Promise<ModelEvent[]> {
  const collected: ModelEvent[] = [];

  for await (const event of events) {
    collected.push(event);
  }

  return collected;
}
