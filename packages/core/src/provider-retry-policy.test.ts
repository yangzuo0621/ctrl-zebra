import { describe, expect, it, vi } from "vitest";

import {
  defaultProviderRetryDelay,
  defaultProviderRetryJitter,
  initialProviderRetryDelayMilliseconds,
  type ModelEvent,
  type ModelGateway,
  ModelGatewayError,
  type ModelRequest,
  maxProviderRetryDelayMilliseconds,
  type ProviderRetryDelay,
  type ProviderRetryJitter,
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
      collect(
        new RetryingModelGateway(gateway.gateway, delay, noJitter()).stream(request, signal()),
      ),
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
      collect(
        new RetryingModelGateway(gateway.gateway, delay, noJitter()).stream(request, signal()),
      ),
    ).resolves.toEqual([{ type: "text.delta", text: "ok" }]);
    expect(gateway.attempts()).toBe(3);
    expect(delay.wait.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([250, 500]);
  });

  it.each(["authentication", "invalid-request", "malformed-response", "unknown"] as const)(
    "does not retry the stable non-retryable %s category",
    async (code) => {
      const failure = new ModelGatewayError(code);
      const gateway = scriptedGateway([failure]);
      const delay = recordingDelay();

      await expect(
        collect(new RetryingModelGateway(gateway.gateway, delay).stream(request, signal())),
      ).rejects.toBe(failure);
      expect(gateway.attempts()).toBe(1);
      expect(delay.wait).not.toHaveBeenCalled();
    },
  );

  it("stops after two retries and propagates the final error", async () => {
    const finalFailure = new ModelGatewayError("unavailable");
    const gateway = scriptedGateway([
      new ModelGatewayError("unavailable"),
      new ModelGatewayError("unavailable"),
      finalFailure,
    ]);
    const delay = recordingDelay();

    await expect(
      collect(
        new RetryingModelGateway(gateway.gateway, delay, noJitter()).stream(request, signal()),
      ),
    ).rejects.toBe(finalFailure);
    expect(gateway.attempts()).toBe(3);
    expect(delay.wait.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([250, 500]);
  });

  it("respects a Provider-requested retryAfterMilliseconds instead of jittered backoff", async () => {
    const gateway = scriptedGateway([
      new ModelGatewayError("rate-limit", { retryAfterMilliseconds: 5_000 }),
      [{ type: "finish", reason: "stop" }],
    ]);
    const delay = recordingDelay();
    const jitter: ProviderRetryJitter = { next: vi.fn() };

    await expect(
      collect(new RetryingModelGateway(gateway.gateway, delay, jitter).stream(request, signal())),
    ).resolves.toEqual([{ type: "finish", reason: "stop" }]);
    expect(delay.wait).toHaveBeenCalledWith(5_000, expect.any(AbortSignal));
    // A Provider-specified wait is honored exactly, not jittered.
    expect(jitter.next).not.toHaveBeenCalled();
  });

  it("clamps a Provider-requested retryAfterMilliseconds to the ceiling", async () => {
    const gateway = scriptedGateway([
      new ModelGatewayError("unavailable", { retryAfterMilliseconds: 120_000 }),
      [{ type: "finish", reason: "stop" }],
    ]);
    const delay = recordingDelay();

    await expect(
      collect(
        new RetryingModelGateway(gateway.gateway, delay, noJitter()).stream(request, signal()),
      ),
    ).resolves.toEqual([{ type: "finish", reason: "stop" }]);
    expect(delay.wait).toHaveBeenCalledWith(
      maxProviderRetryDelayMilliseconds,
      expect.any(AbortSignal),
    );
  });

  it("applies full jitter to the exponential-backoff fallback, bounded by the ceiling", async () => {
    const gateway = scriptedGateway([
      new ModelGatewayError("unavailable"),
      new ModelGatewayError("unavailable"),
      [{ type: "finish", reason: "stop" }],
    ]);
    const delay = recordingDelay();
    // A stub, not a no-op: it must be called with the un-jittered exponential baseline for each
    // attempt (250, then 500), and whatever it returns must reach delay.wait() unchanged.
    const jitter: ProviderRetryJitter = { next: vi.fn((maximum: number) => maximum / 4) };

    await expect(
      collect(new RetryingModelGateway(gateway.gateway, delay, jitter).stream(request, signal())),
    ).resolves.toEqual([{ type: "finish", reason: "stop" }]);
    expect(jitter.next).toHaveBeenNthCalledWith(1, initialProviderRetryDelayMilliseconds);
    expect(jitter.next).toHaveBeenNthCalledWith(2, initialProviderRetryDelayMilliseconds * 2);
    expect(delay.wait.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([62.5, 125]);
  });

  it("clamps jittered exponential backoff to the ceiling", async () => {
    const gateway = scriptedGateway([
      new ModelGatewayError("unavailable"),
      [{ type: "finish", reason: "stop" }],
    ]);
    const delay = recordingDelay();
    const jitter: ProviderRetryJitter = { next: () => 1_000_000 };

    await expect(
      collect(new RetryingModelGateway(gateway.gateway, delay, jitter).stream(request, signal())),
    ).resolves.toEqual([{ type: "finish", reason: "stop" }]);
    expect(delay.wait).toHaveBeenCalledWith(
      maxProviderRetryDelayMilliseconds,
      expect.any(AbortSignal),
    );
  });

  it("defaultProviderRetryJitter returns a value in [0, maximum)", () => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const value = defaultProviderRetryJitter.next(1_000);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1_000);
    }
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

  it.each([
    { type: "reasoning.start", blockId: "reasoning-1" },
    { type: "reasoning.delta", blockId: "reasoning-1", text: "partial" },
    { type: "reasoning.end", blockId: "reasoning-1" },
  ] as const)("does not retry after the reasoning event $type is observable", async (event) => {
    const failure = new ModelGatewayError("unavailable");
    const gateway: ModelGateway = {
      stream: async function* () {
        yield event;
        throw failure;
      },
    };
    const delay = recordingDelay();
    const iterator = new RetryingModelGateway(gateway, delay)
      .stream(request, signal())
      [Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toEqual({ value: event, done: false });
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

/** A jitter stub that returns the un-jittered maximum, for tests asserting exact backoff values. */
function noJitter(): ProviderRetryJitter {
  return { next: (maximum) => maximum };
}

async function collect(events: AsyncIterable<ModelEvent>): Promise<readonly ModelEvent[]> {
  const collected: ModelEvent[] = [];
  for await (const event of events) {
    collected.push(event);
  }
  return collected;
}
