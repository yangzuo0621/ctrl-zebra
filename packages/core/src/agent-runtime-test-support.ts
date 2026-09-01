import type { UserMessage } from "@ctrl-zebra/protocol";
import type { AgentTool, ModelEvent, ModelGateway, ModelRequest } from "./index.js";

export const emptyInputSchema = {
  type: "object",
  properties: {},
  required: [],
  additionalProperties: false,
} as const;

export const userMessage = {
  messageId: "message-1",
  sessionId: "session-1",
  createdAt: "2026-07-16T00:00:00.000Z",
  role: "user",
  content: "Say hello.",
} as const satisfies UserMessage;

export function createModelGateway(
  events: readonly ModelEvent[],
  onRequest: (request: ModelRequest, signal: AbortSignal) => void = () => {},
): ModelGateway {
  return {
    async *stream(request, signal) {
      onRequest(request, signal);
      yield* events;
    },
  };
}

export function createScriptedModelGateway(
  steps: readonly (readonly ModelEvent[])[],
  requests: ModelRequest[],
): ModelGateway {
  let nextStep = 0;

  return {
    async *stream(request, signal) {
      requests.push(request);
      const events = steps[nextStep];
      nextStep += 1;

      if (events === undefined) {
        throw new Error("FakeModel has no scripted response for this request.");
      }

      for (const event of events) {
        signal.throwIfAborted();
        yield event;
      }
    },
  };
}

export function createCountingModelGateway(
  events: readonly ModelEvent[],
  onNext: () => void,
): ModelGateway {
  return {
    stream() {
      let index = 0;
      const iterator: AsyncIterableIterator<ModelEvent> = {
        async next() {
          onNext();
          const event = events[index];
          index += 1;
          return event === undefined
            ? { done: true, value: undefined }
            : { done: false, value: event };
        },
        [Symbol.asyncIterator]() {
          return this;
        },
      };
      return iterator;
    },
  };
}

export function createNumberTool(name: "first_tool" | "second_tool", executionOrder: string[]) {
  return {
    name,
    description: `Execute ${name}.`,
    inputSchema: {
      type: "object",
      properties: { value: { type: "integer", description: "Numeric value." } },
      required: ["value"],
      additionalProperties: false,
    },
    risk: "read" as const,
    parseInput(value: unknown) {
      if (
        typeof value !== "object" ||
        value === null ||
        !("value" in value) ||
        typeof value.value !== "number"
      ) {
        throw new Error("invalid value");
      }

      return { value: value.value };
    },
    async execute(input: { value: number }) {
      executionOrder.push(`${name}:${input.value}`);
      return { output: { value: input.value }, truncated: false };
    },
  } satisfies AgentTool<{ value: number }, { value: number }>;
}
