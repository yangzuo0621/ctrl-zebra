import {
  type ModelEvent,
  ModelGatewayError,
  type ModelGatewayErrorCode,
  type ModelRequest,
} from "@ctrl-zebra/core";
import { APICallError, InvalidResponseDataError, LoadAPIKeyError } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createOpenAIModelGateway } from "./openai-model-gateway.js";

const sdkMocks = vi.hoisted(() => ({
  createOpenAI: vi.fn(),
  streamText: vi.fn(),
}));

vi.mock("@ai-sdk/openai", () => ({ createOpenAI: sdkMocks.createOpenAI }));
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, streamText: sdkMocks.streamText };
});

const request = {
  instructions: "Be concise.",
  messages: [{ role: "user", content: "Say hello." }],
} as const;

const readonlyToolsRequest = createReadonlyToolsRequest();
const nestedToolRequest = createNestedToolRequest();

describe("OpenAI ModelGateway", () => {
  const model = { modelId: "test-model" };
  const selectModel = vi.fn(() => model);

  beforeEach(() => {
    sdkMocks.createOpenAI.mockReset();
    sdkMocks.streamText.mockReset();
    selectModel.mockClear();
    sdkMocks.createOpenAI.mockReturnValue(selectModel);
  });

  it("maps SDK stream parts to Core events in source order", async () => {
    setStreamParts([
      { type: "start" },
      { type: "text-start", id: "text-1" },
      { type: "reasoning-start", id: "sdk-reasoning-1", providerMetadata: { secret: true } },
      { type: "reasoning-delta", id: "sdk-reasoning-1", text: "Check " },
      { type: "text-delta", id: "text-1", text: "Hel" },
      { type: "reasoning-delta", id: "sdk-reasoning-1", text: "facts." },
      {
        type: "reasoning-end",
        id: "sdk-reasoning-1",
        providerMetadata: { openai: { encryptedContent: "opaque" } },
      },
      { type: "raw", rawValue: { encryptedReasoning: "opaque" } },
      {
        type: "tool-call",
        toolCallId: "call-1",
        toolName: "lookup",
        input: { query: "zebra" },
      },
      { type: "reasoning-start", id: "sdk-reasoning-2" },
      { type: "reasoning-delta", id: "sdk-reasoning-2", text: "" },
      { type: "reasoning-delta", id: "sdk-reasoning-2", text: " " },
      { type: "reasoning-end", id: "sdk-reasoning-2" },
      {
        type: "finish-step",
        finishReason: "tool-calls",
        usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
      },
      { type: "text-delta", id: "text-1", text: "lo" },
      {
        type: "finish",
        finishReason: "stop",
        totalUsage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 },
      },
    ]);
    const signal = new AbortController().signal;
    const gateway = createOpenAIModelGateway({ apiKey: "test-key", modelId: "gpt-test" });

    await expect(collectEvents(gateway.stream(request, signal))).resolves.toEqual([
      { type: "reasoning.start", blockId: "reasoning-1" },
      { type: "reasoning.delta", blockId: "reasoning-1", text: "Check " },
      { type: "text.delta", text: "Hel" },
      { type: "reasoning.delta", blockId: "reasoning-1", text: "facts." },
      { type: "reasoning.end", blockId: "reasoning-1" },
      {
        type: "tool.call",
        call: { id: "call-1", name: "lookup", input: { query: "zebra" } },
      },
      { type: "reasoning.start", blockId: "reasoning-2" },
      { type: "reasoning.delta", blockId: "reasoning-2", text: " " },
      { type: "reasoning.end", blockId: "reasoning-2" },
      { type: "text.delta", text: "lo" },
      { type: "usage", usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 } },
      { type: "finish", reason: "stop" },
    ]);
    expect(sdkMocks.createOpenAI).toHaveBeenCalledWith({
      apiKey: "test-key",
      baseURL: undefined,
      fetch: expect.any(Function),
    });
    expect(selectModel).toHaveBeenCalledWith("gpt-test");
    expect(sdkMocks.streamText).toHaveBeenCalledWith({
      abortSignal: signal,
      instructions: request.instructions,
      maxRetries: 0,
      messages: request.messages,
      model,
    });
  });

  it("maps Core Tool Call and Tool Result messages to AI SDK 7 model messages", async () => {
    setStreamParts([{ type: "finish", finishReason: "stop", totalUsage: {} }]);
    const toolRequest = {
      messages: [
        { role: "user", content: "List files." },
        {
          role: "assistant",
          toolCall: { id: "call-1", name: "list_files", input: { path: "." } },
        },
        {
          role: "tool",
          result: {
            callId: "call-1",
            name: "list_files",
            status: "success",
            output: ["README.md"],
            truncated: false,
          },
        },
      ],
    } as const satisfies ModelRequest;
    const signal = new AbortController().signal;
    const gateway = createOpenAIModelGateway({ apiKey: "test-key", modelId: "gpt-test" });

    await collectEvents(gateway.stream(toolRequest, signal));

    expect(sdkMocks.streamText).toHaveBeenCalledWith({
      abortSignal: signal,
      maxRetries: 0,
      messages: [
        { role: "user", content: "List files." },
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "call-1",
              toolName: "list_files",
              input: { path: "." },
            },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "call-1",
              toolName: "list_files",
              output: {
                type: "json",
                value: {
                  callId: "call-1",
                  name: "list_files",
                  status: "success",
                  output: ["README.md"],
                  truncated: false,
                },
              },
            },
          ],
        },
      ],
      model,
    });
  });

  it("maps all read-only declarations to non-executable AI SDK tools", async () => {
    setStreamParts([{ type: "finish", finishReason: "stop", totalUsage: {} }]);
    const gateway = createOpenAIModelGateway({ apiKey: "test-key", modelId: "gpt-test" });

    await collectEvents(gateway.stream(readonlyToolsRequest, new AbortController().signal));

    await expectMappedReadonlyTools(sdkMocks.streamText.mock.calls[0]?.[0]?.tools);
  });

  it("maps nested object and array Tool input schemas to AI SDK 7 JSON Schema", async () => {
    setStreamParts([{ type: "finish", finishReason: "stop", totalUsage: {} }]);
    const gateway = createOpenAIModelGateway({ apiKey: "test-key", modelId: "gpt-test" });

    await collectEvents(gateway.stream(nestedToolRequest, new AbortController().signal));

    expect(
      readSdkToolJsonSchema(sdkMocks.streamText.mock.calls[0]?.[0]?.tools, "propose_file_edit"),
    ).toEqual(nestedToolRequest.tools?.[0]?.inputSchema);
  });

  it("passes a boundary-validated external Draft 2020-12 Tool schema without narrowing it", async () => {
    setStreamParts([{ type: "finish", finishReason: "stop", totalUsage: {} }]);
    const gateway = createOpenAIModelGateway({ apiKey: "test-key", modelId: "gpt-test" });
    const externalSchema = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: { value: { anyOf: [{ type: "string" }, { type: "integer" }] } },
      required: ["value"],
      additionalProperties: false,
    } as const;
    const externalRequest: ModelRequest = {
      messages: request.messages,
      tools: [
        {
          name: "mcp_external_000000000000",
          description: "External tool.",
          inputSchema: {
            kind: "external_json_schema_2020_12",
            jsonSchema: externalSchema,
          },
        },
      ],
    };

    await collectEvents(gateway.stream(externalRequest, new AbortController().signal));

    expect(
      readSdkToolJsonSchema(
        sdkMocks.streamText.mock.calls[0]?.[0]?.tools,
        "mcp_external_000000000000",
      ),
    ).toEqual(externalSchema);
  });

  it("passes a validated custom endpoint to the SDK provider", () => {
    createOpenAIModelGateway({
      apiKey: "test-key",
      modelId: "gpt-test",
      baseURL: "https://models.example.test/v1",
    });

    expect(sdkMocks.createOpenAI).toHaveBeenCalledWith({
      apiKey: "test-key",
      baseURL: "https://models.example.test/v1",
      fetch: expect.any(Function),
    });
  });

  it("rejects endpoint redirects while preserving request options", async () => {
    createOpenAIModelGateway({ apiKey: "test-key", modelId: "gpt-test" });
    const providerOptions = sdkMocks.createOpenAI.mock.calls[0]?.[0];
    const providerFetch = providerOptions?.fetch;
    const signal = new AbortController().signal;
    const response = new Response(null, { status: 204 });
    const fetchMock = vi.fn(async () => response);
    vi.stubGlobal("fetch", fetchMock);

    try {
      await expect(
        providerFetch?.("https://models.example.test/v1", {
          headers: { "x-test": "value" },
          signal,
        }),
      ).resolves.toBe(response);
      expect(fetchMock).toHaveBeenCalledWith("https://models.example.test/v1", {
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
    const gateway = createOpenAIModelGateway({ apiKey: "test-key", modelId: "gpt-test" });

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

  it("closes delivery at finish and ignores late SDK reasoning events", async () => {
    setStreamParts([
      { type: "text-delta", id: "text-1", text: "done" },
      { type: "finish", finishReason: "stop", totalUsage: {} },
      { type: "reasoning-start", id: "late-reasoning" },
      { type: "reasoning-delta", id: "late-reasoning", text: "late" },
      { type: "reasoning-end", id: "late-reasoning" },
    ]);
    const gateway = createOpenAIModelGateway({ apiKey: "test-key", modelId: "gpt-test" });

    await expect(
      collectEvents(gateway.stream(request, new AbortController().signal)),
    ).resolves.toEqual([
      { type: "text.delta", text: "done" },
      {
        type: "usage",
        usage: { inputTokens: undefined, outputTokens: undefined, totalTokens: undefined },
      },
      { type: "finish", reason: "stop" },
    ]);
  });

  it("preserves a valid empty reasoning block without inventing content", async () => {
    setStreamParts([
      { type: "reasoning-start", id: "empty-reasoning" },
      { type: "reasoning-end", id: "empty-reasoning" },
      { type: "text-delta", id: "text-1", text: "answer" },
      { type: "finish", finishReason: "stop", totalUsage: {} },
    ]);
    const gateway = createOpenAIModelGateway({ apiKey: "test-key", modelId: "gpt-test" });

    const events = await collectEvents(gateway.stream(request, new AbortController().signal));

    expect(events.slice(0, 3)).toEqual([
      { type: "reasoning.start", blockId: "reasoning-1" },
      { type: "reasoning.end", blockId: "reasoning-1" },
      { type: "text.delta", text: "answer" },
    ]);
  });

  it.each([
    [401, false, "authentication"],
    [403, false, "permission-denied"],
    [404, false, "model-not-found"],
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
    const gateway = createOpenAIModelGateway({ apiKey: "test-key", modelId: "gpt-test" });

    await expect(
      collectEvents(gateway.stream(request, new AbortController().signal)),
    ).rejects.toMatchObject({
      code: expectedCode,
    });
  });

  it("classifies a structured context overflow without inspecting provider text", async () => {
    sdkMocks.streamText.mockImplementation(() => {
      throw new APICallError({
        isRetryable: false,
        message: "private provider wording",
        requestBodyValues: {},
        statusCode: 400,
        url: "https://example.invalid",
        data: { error: { code: "context_length_exceeded", message: "secret" } },
      });
    });
    const gateway = createOpenAIModelGateway({ apiKey: "test-key", modelId: "gpt-test" });

    await expect(
      collectEvents(gateway.stream(request, new AbortController().signal)),
    ).rejects.toEqual(new ModelGatewayError("context-overflow"));
  });

  it.each([
    [new LoadAPIKeyError({ message: "missing key" }), "authentication"],
    [new InvalidResponseDataError({ data: null }), "malformed-response"],
  ] as const)("maps typed SDK failures without inspecting their messages", async (failure, expectedCode) => {
    setStreamParts([{ type: "error", error: failure }]);
    const gateway = createOpenAIModelGateway({ apiKey: "test-key", modelId: "gpt-test" });

    await expect(
      collectEvents(gateway.stream(request, new AbortController().signal)),
    ).rejects.toMatchObject({
      code: expectedCode satisfies ModelGatewayErrorCode,
    });
  });

  it("rejects malformed SDK parts at the provider boundary", async () => {
    setStreamParts([
      {
        type: "finish",
        finishReason: "stop",
        totalUsage: { inputTokens: -1, outputTokens: 2, totalTokens: 1 },
      },
    ]);
    const gateway = createOpenAIModelGateway({ apiKey: "test-key", modelId: "gpt-test" });

    await expect(
      collectEvents(gateway.stream(request, new AbortController().signal)),
    ).rejects.toMatchObject({
      code: "malformed-response",
    });
  });

  it.each([
    { parts: [{ type: "reasoning-delta", id: "missing", text: "delta" }] },
    { parts: [{ type: "reasoning-start", id: "" }] },
    { parts: [{ type: "reasoning-start", id: "reasoning-1" }] },
    {
      parts: [
        { type: "reasoning-start", id: "reasoning-1" },
        { type: "reasoning-start", id: "reasoning-2" },
      ],
    },
    {
      parts: [
        { type: "reasoning-start", id: "reasoning-1" },
        { type: "reasoning-end", id: "reasoning-2" },
      ],
    },
    {
      parts: [
        { type: "reasoning-start", id: "reasoning-1" },
        { type: "reasoning-end", id: "reasoning-1" },
        { type: "reasoning-end", id: "reasoning-1" },
      ],
    },
    {
      parts: [
        { type: "reasoning-start", id: "reasoning-1" },
        { type: "finish", finishReason: "stop", totalUsage: {} },
      ],
    },
    {
      parts: [
        { type: "reasoning-start", id: "reasoning-1" },
        { type: "reasoning-end", id: "reasoning-1" },
        { type: "reasoning-start", id: "reasoning-1" },
      ],
    },
    {
      parts: [
        { type: "reasoning-start", id: "reasoning-1" },
        { type: "reasoning-delta", id: "reasoning-1", text: "\ud800" },
      ],
    },
  ])("rejects malformed reasoning lifecycle %#", async ({ parts }) => {
    setStreamParts(parts);
    const gateway = createOpenAIModelGateway({ apiKey: "test-key", modelId: "gpt-test" });

    await expect(
      collectEvents(gateway.stream(request, new AbortController().signal)),
    ).rejects.toMatchObject({
      code: "malformed-response",
    });
  });

  it("splits oversized reasoning deltas at Unicode code-point and UTF-8 boundaries", async () => {
    const text = "😀".repeat(8_193);
    setStreamParts([
      { type: "reasoning-start", id: "reasoning-1" },
      { type: "reasoning-delta", id: "reasoning-1", text },
      { type: "reasoning-end", id: "reasoning-1" },
      { type: "finish", finishReason: "stop", totalUsage: {} },
    ]);
    const gateway = createOpenAIModelGateway({ apiKey: "test-key", modelId: "gpt-test" });

    const events = await collectEvents(gateway.stream(request, new AbortController().signal));

    expect(events.slice(0, 4)).toEqual([
      { type: "reasoning.start", blockId: "reasoning-1" },
      { type: "reasoning.delta", blockId: "reasoning-1", text: "😀".repeat(8_192) },
      { type: "reasoning.delta", blockId: "reasoning-1", text: "😀" },
      { type: "reasoning.end", blockId: "reasoning-1" },
    ]);
  });

  it.each([
    { toolCallId: "call-1", toolName: "ReadFile", input: {} },
    { toolCallId: "call-1", toolName: "read_file", input: Number.NaN },
  ])("rejects a malformed SDK Tool Call %#", async (call) => {
    setStreamParts([{ type: "tool-call", ...call }]);
    const gateway = createOpenAIModelGateway({ apiKey: "test-key", modelId: "gpt-test" });

    await expect(
      collectEvents(gateway.stream(request, new AbortController().signal)),
    ).rejects.toMatchObject({
      code: "malformed-response",
    });
  });

  it("forwards cancellation and emits no later events", async () => {
    setStreamParts([
      { type: "reasoning-start", id: "reasoning-1" },
      { type: "reasoning-delta", id: "reasoning-1", text: "before" },
      { type: "reasoning-end", id: "reasoning-1" },
      { type: "text-delta", id: "text-1", text: "after" },
    ]);
    const cancellation = new Error("cancelled by test");
    const controller = new AbortController();
    const gateway = createOpenAIModelGateway({ apiKey: "test-key", modelId: "gpt-test" });
    const events: ModelEvent[] = [];

    const consume = async () => {
      for await (const event of gateway.stream(request, controller.signal)) {
        events.push(event);
        if (event.type === "reasoning.delta") {
          controller.abort(cancellation);
        }
      }
    };

    await expect(consume()).rejects.toBe(cancellation);
    expect(events).toEqual([
      { type: "reasoning.start", blockId: "reasoning-1" },
      { type: "reasoning.delta", blockId: "reasoning-1", text: "before" },
    ]);
    expect(sdkMocks.streamText).toHaveBeenCalledWith(
      expect.objectContaining({ abortSignal: controller.signal }),
    );
  });

  it("does not start the SDK when already cancelled", async () => {
    const cancellation = new Error("cancelled before start");
    const controller = new AbortController();
    controller.abort(cancellation);
    const gateway = createOpenAIModelGateway({ apiKey: "test-key", modelId: "gpt-test" });

    await expect(collectEvents(gateway.stream(request, controller.signal))).rejects.toBe(
      cancellation,
    );
    expect(sdkMocks.streamText).not.toHaveBeenCalled();
  });
});

function setStreamParts(parts: readonly unknown[]): void {
  sdkMocks.streamText.mockReturnValue({ stream: streamParts(parts) });
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

function createReadonlyToolsRequest(): ModelRequest {
  return {
    messages: request.messages,
    tools: [
      createToolDeclaration("list_files", "List workspace files.", "glob", false),
      createToolDeclaration("read_file", "Read a workspace file.", "path", true),
      createToolDeclaration("search_files", "Search workspace files.", "query", true),
    ],
  };
}

function createNestedToolRequest(): ModelRequest {
  return {
    messages: request.messages,
    tools: [
      {
        name: "propose_file_edit",
        description: "Propose text edits.",
        inputSchema: {
          type: "object",
          properties: {
            edits: {
              type: "array",
              description: "Text edits.",
              minItems: 1,
              maxItems: 256,
              items: {
                type: "object",
                description: "One text edit.",
                properties: {
                  newText: {
                    type: "string",
                    description: "Replacement text.",
                    maxLength: 262_144,
                  },
                },
                required: ["newText"],
                additionalProperties: false,
              },
            },
          },
          required: ["edits"],
          additionalProperties: false,
        },
      },
    ],
  };
}

function createToolDeclaration(
  name: "list_files" | "read_file" | "search_files",
  description: string,
  propertyName: string,
  required: boolean,
) {
  return {
    name,
    description,
    inputSchema: {
      type: "object" as const,
      properties: {
        [propertyName]: { type: "string" as const, description: `${propertyName} input.` },
      },
      required: required ? [propertyName] : [],
      additionalProperties: false as const,
    },
  };
}

async function expectMappedReadonlyTools(tools: Record<string, unknown>): Promise<void> {
  expect(Object.keys(tools)).toEqual(["list_files", "read_file", "search_files"]);

  for (const declaration of readonlyToolsRequest.tools ?? []) {
    const sdkTool = tools[declaration.name] as {
      readonly description: string;
      readonly execute?: unknown;
      readonly inputSchema: { readonly jsonSchema: unknown };
    };
    expect(sdkTool.description).toBe(declaration.description);
    expect(sdkTool.execute).toBeUndefined();
    expect(sdkTool.inputSchema.jsonSchema).toEqual(declaration.inputSchema);
  }
}

function readSdkToolJsonSchema(tools: unknown, name: string): unknown {
  const toolsRecord = readRecord(tools);
  const tool = readRecord(toolsRecord[name]);
  const inputSchema = readRecord(tool.inputSchema);
  return inputSchema.jsonSchema;
}

function readRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Expected an object in the mocked AI SDK call.");
  }

  return Object.fromEntries(Object.entries(value));
}
