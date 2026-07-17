import type { ModelEvent, ModelRequest } from "@ctrl-zebra/core";
import { describe, expect, it } from "vitest";

import { FakeModelGateway } from "./index.js";

const request = {
  messages: [{ role: "user", content: "List the files." }],
} as const satisfies ModelRequest;

describe("FakeModelGateway", () => {
  it("streams its configured events in order", async () => {
    const events = [
      { type: "text.delta", text: "I will look." },
      {
        type: "tool.call",
        call: { id: "call-1", name: "list_files", input: { path: "." } },
      },
      {
        type: "usage",
        usage: { inputTokens: 8, outputTokens: 5, totalTokens: 13 },
      },
      { type: "finish", reason: "tool-calls" },
    ] as const satisfies readonly ModelEvent[];
    const gateway = new FakeModelGateway([events]);
    const received: ModelEvent[] = [];

    for await (const event of gateway.stream(request, new AbortController().signal)) {
      received.push(event);
    }

    expect(received).toEqual(events);
  });

  it("completes an empty event sequence", async () => {
    const gateway = new FakeModelGateway([[]]);

    const received = await Array.fromAsync(gateway.stream(request, new AbortController().signal));

    expect(received).toEqual([]);
  });

  it("stops before another event when cancelled", async () => {
    const cancellation = new Error("cancelled by test");
    const controller = new AbortController();
    const gateway = new FakeModelGateway([
      [
        { type: "text.delta", text: "first" },
        { type: "text.delta", text: "second" },
      ],
    ]);
    const iterator = gateway.stream(request, controller.signal)[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { type: "text.delta", text: "first" },
    });

    controller.abort(cancellation);

    await expect(iterator.next()).rejects.toBe(cancellation);
  });

  it("rejects an already-cancelled empty stream", async () => {
    const cancellation = new Error("cancelled before streaming");
    const controller = new AbortController();
    controller.abort(cancellation);
    const gateway = new FakeModelGateway([[]]);

    await expect(
      gateway.stream(request, controller.signal)[Symbol.asyncIterator]().next(),
    ).rejects.toBe(cancellation);
  });

  it("returns scripted responses in request order and records each request", async () => {
    const secondRequest = {
      messages: [
        ...request.messages,
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
    const gateway = new FakeModelGateway([
      [{ type: "finish", reason: "tool-calls" }],
      [{ type: "text.delta", text: "README.md" }],
    ]);

    await expect(
      Array.fromAsync(gateway.stream(request, new AbortController().signal)),
    ).resolves.toEqual([{ type: "finish", reason: "tool-calls" }]);
    await expect(
      Array.fromAsync(gateway.stream(secondRequest, new AbortController().signal)),
    ).resolves.toEqual([{ type: "text.delta", text: "README.md" }]);
    expect(gateway.requests).toEqual([request, secondRequest]);
  });
});
