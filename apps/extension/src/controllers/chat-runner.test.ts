import type { AgentRuntimeEvent, ModelGateway, ModelRequest } from "@ctrl-zebra/core";
import { describe, expect, it } from "vitest";

import {
  createChatRunner,
  createUnconfiguredChatRunner,
  ModelProviderNotConfiguredError,
} from "./chat-runner.js";

describe("createChatRunner", () => {
  it("runs the injected ModelGateway and emits ordered Agent Runtime events", async () => {
    let receivedRequest: ModelRequest | undefined;
    let receivedSignal: AbortSignal | undefined;
    const modelGateway: ModelGateway = {
      async *stream(request, signal) {
        receivedRequest = request;
        receivedSignal = signal;
        yield { type: "text.delta", text: "Hello" };
        yield { type: "finish", reason: "stop" };
      },
    };
    const events: AgentRuntimeEvent[] = [];
    const ids = ["session-1", "message-1"];
    const signal = new AbortController().signal;
    const runner = createChatRunner({
      modelGateway,
      createId: () => ids.shift() ?? "unexpected-id",
      now: () => new Date("2026-07-16T00:00:00.000Z"),
    });

    await runner.run("Say hello.", signal, (event) => events.push(event));

    expect(receivedRequest).toEqual({
      messages: [{ role: "user", content: "Say hello." }],
    });
    expect(receivedSignal).toBe(signal);
    expect(events.map((event) => event.type)).toEqual([
      "session.status-changed",
      "session.status-changed",
      "agent.text-delta",
      "session.status-changed",
    ]);
    expect(events[0]).toMatchObject({ sessionId: "session-1" });
  });

  it("preserves cancellation before creating a session or starting the gateway", async () => {
    let gatewayStarted = false;
    let idCreated = false;
    const modelGateway: ModelGateway = {
      async *stream() {
        gatewayStarted = true;
        yield { type: "finish", reason: "stop" };
      },
    };
    const cancellation = new Error("cancelled before run");
    const abortController = new AbortController();
    abortController.abort(cancellation);
    const runner = createChatRunner({
      modelGateway,
      createId() {
        idCreated = true;
        return "unexpected-id";
      },
    });

    await expect(runner.run("Hello", abortController.signal, () => {})).rejects.toBe(cancellation);
    expect(idCreated).toBe(false);
    expect(gatewayStarted).toBe(false);
  });
});

describe("createUnconfiguredChatRunner", () => {
  it("fails without selecting a concrete Provider", async () => {
    const runner = createUnconfiguredChatRunner();

    await expect(
      runner.run("Hello", new AbortController().signal, () => {}),
    ).rejects.toBeInstanceOf(ModelProviderNotConfiguredError);
  });
});
