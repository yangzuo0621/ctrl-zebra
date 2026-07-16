import type { AgentRuntimeEvent, ModelGateway } from "@ctrl-zebra/core";
import { describe, expect, it } from "vitest";

import { ApiKeyRequiredError, createChatRunner } from "./chat-runner.js";

function createStorage(initialValue?: string) {
  let value = initialValue;
  return {
    storage: {
      async read() {
        return value;
      },
      async save(apiKey: string) {
        value = apiKey;
      },
      async delete() {
        value = undefined;
      },
    },
    readValue: () => value,
  };
}

function createGateway(): ModelGateway {
  return {
    async *stream() {
      yield { type: "text.delta", text: "Hello" };
      yield { type: "finish", reason: "stop" };
    },
  };
}

describe("createChatRunner", () => {
  it("uses the stored key for one Agent Runtime run without prompting", async () => {
    const { storage } = createStorage("test-openai-api-key");
    const prompted: string[] = [];
    const gatewayKeys: string[] = [];
    const events: AgentRuntimeEvent[] = [];
    const ids = ["session-1", "message-1"];
    const runner = createChatRunner({
      apiKeyStorage: storage,
      async requestApiKey() {
        prompted.push("prompted");
        return undefined;
      },
      createGateway(apiKey) {
        gatewayKeys.push(apiKey);
        return createGateway();
      },
      createId: () => ids.shift() ?? "unexpected-id",
      now: () => new Date("2026-07-16T00:00:00.000Z"),
    });

    await runner.run("Say hello.", new AbortController().signal, (event) => events.push(event));

    expect(prompted).toEqual([]);
    expect(gatewayKeys).toEqual(["test-openai-api-key"]);
    expect(events.map((event) => event.type)).toEqual([
      "session.status-changed",
      "session.status-changed",
      "agent.text-delta",
      "session.status-changed",
    ]);
  });

  it("prompts for and saves a missing key before creating the gateway", async () => {
    const { storage, readValue } = createStorage();
    const runner = createChatRunner({
      apiKeyStorage: storage,
      async requestApiKey() {
        return "test-openai-api-key";
      },
      createGateway: createGateway,
      createId: (() => {
        let id = 0;
        return () => `id-${++id}`;
      })(),
    });

    await runner.run("Hello", new AbortController().signal, () => {});

    expect(readValue()).toBe("test-openai-api-key");
  });

  it("fails safely when no key is supplied and never creates a gateway", async () => {
    const { storage } = createStorage();
    let gatewayCreated = false;
    const runner = createChatRunner({
      apiKeyStorage: storage,
      async requestApiKey() {
        return undefined;
      },
      createGateway() {
        gatewayCreated = true;
        return createGateway();
      },
    });

    await expect(
      runner.run("Hello", new AbortController().signal, () => {}),
    ).rejects.toBeInstanceOf(ApiKeyRequiredError);
    expect(gatewayCreated).toBe(false);
  });
});
