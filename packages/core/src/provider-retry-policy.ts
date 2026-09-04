import {
  type ModelEvent,
  type ModelGateway,
  ModelGatewayError,
  type ModelRequest,
} from "./model-gateway.js";

export const maxProviderRetryAttempts = 2;
export const initialProviderRetryDelayMilliseconds = 250;
/**
 * A ceiling on any single retry wait, including a Provider-requested `retryAfterMilliseconds`.
 * Protects an interactive Run from blocking indefinitely on an unreasonable or malformed
 * Provider-supplied wait; a real, actionable rate limit longer than this is better surfaced as a
 * failure than as a silent multi-minute hang.
 */
export const maxProviderRetryDelayMilliseconds = 30_000;

export interface ProviderRetryDelay {
  wait(milliseconds: number, signal: AbortSignal): Promise<void>;
}

/** A source of jitter for the exponential-backoff fallback, injectable for deterministic tests. */
export interface ProviderRetryJitter {
  /** Returns a value in the half-open range [0, maximum). */
  next(maximum: number): number;
}

export const defaultProviderRetryJitter: ProviderRetryJitter = {
  next: (maximum) => Math.random() * maximum,
};

export const defaultProviderRetryDelay: ProviderRetryDelay = {
  async wait(milliseconds, signal) {
    signal.throwIfAborted();

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        signal.removeEventListener("abort", cancel);
        resolve();
      }, milliseconds);
      const cancel = () => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", cancel);
        reject(signal.reason);
      };

      signal.addEventListener("abort", cancel, { once: true });
      if (signal.aborted) {
        cancel();
      }
    });
  },
};

export class RetryingModelGateway implements ModelGateway {
  constructor(
    readonly gateway: ModelGateway,
    readonly delay: ProviderRetryDelay = defaultProviderRetryDelay,
    readonly jitter: ProviderRetryJitter = defaultProviderRetryJitter,
  ) {}

  async *stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelEvent> {
    let retries = 0;

    while (true) {
      signal.throwIfAborted();
      let emittedEvent = false;

      try {
        for await (const event of this.gateway.stream(request, signal)) {
          signal.throwIfAborted();
          emittedEvent = true;
          yield event;
        }
        return;
      } catch (error) {
        if (signal.aborted) {
          signal.throwIfAborted();
        }

        if (
          emittedEvent ||
          !isRetryableProviderError(error) ||
          retries >= maxProviderRetryAttempts
        ) {
          throw error;
        }

        const backoffMilliseconds = this.computeBackoffMilliseconds(error, retries);
        retries += 1;
        await this.delay.wait(backoffMilliseconds, signal);
      }
    }
  }

  /**
   * Honors a Provider-requested `retryAfterMilliseconds` exactly (clamped to the ceiling) rather
   * than jittering it: the Provider gave a specific number, and jittering it away would defeat
   * its purpose. Only the un-guided exponential-backoff fallback is jittered, using "full jitter"
   * (uniform over [0, baseline)) to avoid every concurrent retry in this Run waking in lockstep.
   */
  private computeBackoffMilliseconds(error: ModelGatewayError, retries: number): number {
    if (error.retryAfterMilliseconds !== undefined) {
      return Math.min(error.retryAfterMilliseconds, maxProviderRetryDelayMilliseconds);
    }

    const baseline = initialProviderRetryDelayMilliseconds * 2 ** retries;
    return Math.min(this.jitter.next(baseline), maxProviderRetryDelayMilliseconds);
  }
}

function isRetryableProviderError(error: unknown): error is ModelGatewayError {
  return (
    error instanceof ModelGatewayError &&
    (error.code === "rate-limit" || error.code === "unavailable")
  );
}
