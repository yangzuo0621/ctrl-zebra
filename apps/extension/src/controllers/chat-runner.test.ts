import {
  type AgentRuntimeEvent,
  InMemorySessionRepository,
  type ModelGateway,
  type ModelRequest,
  ToolRegistry,
} from "@ctrl-zebra/core";
import { describe, expect, it } from "vitest";

import { createChatRunner, createSelectingChatRunner } from "./chat-runner.js";

describe("createChatRunner", () => {
  it("persists the user message and ordered runtime events", async () => {
    const repository = new InMemorySessionRepository();
    const timestamps = [
      "2026-07-19T10:00:00.000Z",
      "2026-07-19T10:00:01.000Z",
      "2026-07-19T10:00:02.000Z",
      "2026-07-19T10:00:03.000Z",
      "2026-07-19T10:00:04.000Z",
    ];
    const runner = createChatRunner({
      modelGateway: {
        async *stream() {
          yield { type: "text.delta", text: "Hello" } as const;
          yield { type: "finish", reason: "stop" } as const;
        },
      },
      createId: (() => {
        const ids = ["session-1", "message-1"];
        return () => ids.shift() ?? "unexpected-id";
      })(),
      now: () => new Date(timestamps.shift() ?? "2026-07-19T10:00:05.000Z"),
      sessionRepository: repository,
    });

    await runner.run("Say hello.", new AbortController().signal, () => {});

    const record = await repository.get("session-1");
    expect(record?.manifest).toMatchObject({ status: "completed", lastEventSequence: 5 });
    expect(record?.events.map(({ event }) => event.type)).toEqual([
      "session.user-message",
      "session.status-changed",
      "session.status-changed",
      "agent.text-delta",
      "session.status-changed",
    ]);
    expect(record?.events[0]?.event.data).toMatchObject({
      role: "user",
      content: "Say hello.",
    });
  });

  it("does not start the model when Session persistence cannot be created", async () => {
    let gatewayStarted = false;
    const runner = createChatRunner({
      modelGateway: {
        async *stream() {
          gatewayStarted = true;
          yield { type: "finish", reason: "stop" } as const;
        },
      },
      sessionRepository: {
        async create() {
          throw new Error("storage unavailable");
        },
        async get() {
          return undefined;
        },
        async list() {
          return [];
        },
        async update() {},
        async appendEvent() {},
      },
    });

    await expect(runner.run("Hello", new AbortController().signal, () => {})).rejects.toThrow(
      "storage unavailable",
    );
    expect(gatewayStarted).toBe(false);
  });

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
      instructions: expect.stringContaining("greetings and simple questions without using tools"),
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

  it("forwards a model Tool Call through the registry and returns its result with UI lifecycle events", async () => {
    const requests: ModelRequest[] = [];
    let step = 0;
    const modelGateway: ModelGateway = {
      async *stream(request) {
        requests.push(request);
        if (step === 0) {
          step += 1;
          yield {
            type: "tool.call",
            call: { id: "call-1", name: "list_files", input: {} },
          } as const;
          yield { type: "finish", reason: "tool-calls" } as const;
          return;
        }

        yield { type: "text.delta", text: "README.md" } as const;
        yield { type: "finish", reason: "stop" } as const;
      },
    };
    const registry = new ToolRegistry();
    registry.register({
      name: "list_files",
      description: "List workspace files.",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
      },
      risk: "read",
      parseInput: () => null,
      execute: async () => ({ output: { files: ["README.md"] }, truncated: false }),
    });
    const events: AgentRuntimeEvent[] = [];
    const ids = ["session-1", "message-1"];
    const runner = createChatRunner({
      modelGateway,
      toolRegistry: registry,
      createId: () => ids.shift() ?? "unexpected-id",
      now: () => new Date("2026-07-18T00:00:00.000Z"),
    });

    await runner.run("List files.", new AbortController().signal, (event) => events.push(event));

    expect(requests[0]?.tools?.map(({ name }) => name)).toEqual(["list_files"]);
    expect(requests[1]?.messages.at(-1)).toEqual({
      role: "tool",
      result: {
        callId: "call-1",
        name: "list_files",
        status: "success",
        output: { files: ["README.md"] },
        truncated: false,
      },
    });
    expect(
      events.filter((event) => event.type === "agent.tool-state").map(({ status }) => status),
    ).toEqual(["pending", "running", "success"]);
    expect(events).toContainEqual({
      type: "agent.text-delta",
      sessionId: "session-1",
      text: "README.md",
    });
  });
});

describe("createSelectingChatRunner", () => {
  it("selects a ModelGateway lazily for each run", async () => {
    const gateway: ModelGateway = {
      async *stream() {
        yield { type: "text.delta", text: "Done" };
        yield { type: "finish", reason: "stop" };
      },
    };
    let selections = 0;
    const runner = createSelectingChatRunner({
      selectModelGateway: async () => {
        selections += 1;
        return gateway;
      },
      createId: () => `id-${selections}`,
    });

    expect(selections).toBe(0);
    await runner.run("First", new AbortController().signal, () => {});
    await runner.run("Second", new AbortController().signal, () => {});
    expect(selections).toBe(2);
  });

  it("does not read configuration or Secrets when already cancelled", async () => {
    let selected = false;
    const cancellation = new Error("cancelled before Provider selection");
    const controller = new AbortController();
    controller.abort(cancellation);
    const runner = createSelectingChatRunner({
      selectModelGateway: async () => {
        selected = true;
        throw new Error("unexpected selection");
      },
    });

    await expect(runner.run("Hello", controller.signal, () => {})).rejects.toBe(cancellation);
    expect(selected).toBe(false);
  });
});
