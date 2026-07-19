import { describe, expect, it, vi } from "vitest";

import {
  defaultProviderRetryDelay,
  initialProviderRetryDelayMilliseconds,
  type ModelEvent,
  type ModelGateway,
  ModelGatewayError,
  type ModelRequest,
  type ProviderRetryDelay,
  RetryingModelGateway,
} from "./index.js";

const request = { messages: [{ role: "user", content: "Hello" }] } as const satisfies ModelRequest;

describe("RetryingModelGateway", () => {
  it("retries a rate-limit error after backoff", async () => {
    const gateway = scriptedGateway([
      new ModelGatewayError("rate-limit"),
      [{ type: "finish", reason: "stop" }],
    ]);
    const delay = recordingDelay();

    await expect(
      collect(new RetryingModelGateway(gateway.gateway, delay).stream(request, signal())),
    ).resolves.toEqual([{ type: "finish", reason: "stop" }]);
    expect(gateway.attempts()).toBe(2);
    expect(delay.wait).toHaveBeenCalledWith(
      initialProviderRetryDelayMilliseconds,
      expect.any(AbortSignal),
    );
  });

  it("retries an unavailable service with exponential backoff", async () => {
    const gateway = scriptedGateway([
      new ModelGatewayError("unavailable"),
      new ModelGatewayError("unavailable"),
      [{ type: "text.delta", text: "ok" }],
    ]);
    const delay = recordingDelay();

    await expect(
      collect(new RetryingModelGateway(gateway.gateway, delay).stream(request, signal())),
    ).resolves.toEqual([{ type: "text.delta", text: "ok" }]);
    expect(gateway.attempts()).toBe(3);
    expect(delay.wait.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([250, 500]);
  });

  it.each([
    "authentication",
    "invalid-request",
    "malformed-response",
    "unknown",
  ] as const)("does not retry the stable non-retryable %s category", async (code) => {
    const failure = new ModelGatewayError(code);
    const gateway = scriptedGateway([failure]);
    const delay = recordingDelay();

    await expect(
      collect(new RetryingModelGateway(gateway.gateway, delay).stream(request, signal())),
    ).rejects.toBe(failure);
    expect(gateway.attempts()).toBe(1);
    expect(delay.wait).not.toHaveBeenCalled();
  });

  it("stops after two retries and propagates the final error", async () => {
    const finalFailure = new ModelGatewayError("unavailable");
    const gateway = scriptedGateway([
      new ModelGatewayError("unavailable"),
      new ModelGatewayError("unavailable"),
      finalFailure,
    ]);
    const delay = recordingDelay();

    await expect(
      collect(new RetryingModelGateway(gateway.gateway, delay).stream(request, signal())),
    ).rejects.toBe(finalFailure);
    expect(gateway.attempts()).toBe(3);
    expect(delay.wait.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([250, 500]);
  });

  it("does not retry after any stream event has been emitted", async () => {
    const failure = new ModelGatewayError("unavailable");
    const gateway: ModelGateway = {
      stream: async function* () {
        yield { type: "text.delta", text: "partial" };
        throw failure;
      },
    };
    const delay = recordingDelay();
    const iterator = new RetryingModelGateway(gateway, delay)
      .stream(request, signal())
      [Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toEqual({
      value: { type: "text.delta", text: "partial" },
      done: false,
    });
    await expect(iterator.next()).rejects.toBe(failure);
    expect(delay.wait).not.toHaveBeenCalled();
  });

  it("does not retry an error outside the stable ModelGateway contract", async () => {
    const failure = new Error("internal Core failure");
    const gateway = scriptedGateway([failure]);
    const delay = recordingDelay();

    await expect(
      collect(new RetryingModelGateway(gateway.gateway, delay).stream(request, signal())),
    ).rejects.toBe(failure);
    expect(delay.wait).not.toHaveBeenCalled();
  });

  it("propagates cancellation during backoff without another attempt", async () => {
    const controller = new AbortController();
    const cancellation = new Error("cancel retry delay");
    const gateway = scriptedGateway([new ModelGatewayError("rate-limit")]);
    const delay: ProviderRetryDelay = {
      wait: vi.fn(async (_milliseconds, receivedSignal) => {
        controller.abort(cancellation);
        receivedSignal.throwIfAborted();
      }),
    };

    await expect(
      collect(new RetryingModelGateway(gateway.gateway, delay).stream(request, controller.signal)),
    ).rejects.toBe(cancellation);
    expect(gateway.attempts()).toBe(1);
  });

  it("cancels and clears the default delay", async () => {
    const controller = new AbortController();
    const cancellation = new Error("cancel default delay");
    const waiting = defaultProviderRetryDelay.wait(10_000, controller.signal);

    controller.abort(cancellation);

    await expect(waiting).rejects.toBe(cancellation);
  });

  it("does not start the default delay when already cancelled", async () => {
    const controller = new AbortController();
    const cancellation = new Error("already cancelled");
    controller.abort(cancellation);

    await expect(defaultProviderRetryDelay.wait(10_000, controller.signal)).rejects.toBe(
      cancellation,
    );
  });
});

function scriptedGateway(script: readonly (Error | readonly ModelEvent[])[]) {
  let attempt = 0;

  return {
    gateway: {
      stream: async function* () {
        const result = script[attempt];
        attempt += 1;
        if (result === undefined) {
          throw new Error("Provider retry test script exhausted.");
        }
        if (result instanceof Error) {
          throw result;
        }
        yield* result;
      },
    } satisfies ModelGateway,
    attempts: () => attempt,
  };
}

function recordingDelay() {
  return {
    wait: vi.fn(async (_milliseconds: number, receivedSignal: AbortSignal) => {
      receivedSignal.throwIfAborted();
    }),
  } satisfies ProviderRetryDelay;
}

function signal(): AbortSignal {
  return new AbortController().signal;
}

async function collect(events: AsyncIterable<ModelEvent>): Promise<readonly ModelEvent[]> {
  const collected: ModelEvent[] = [];
  for await (const event of events) {
    collected.push(event);
  }
  return collected;
}
