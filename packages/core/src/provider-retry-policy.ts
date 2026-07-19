import {
  type ModelEvent,
  type ModelGateway,
  ModelGatewayError,
  type ModelRequest,
} from "./model-gateway.js";

export const maxProviderRetryAttempts = 2;
export const initialProviderRetryDelayMilliseconds = 250;

export interface ProviderRetryDelay {
  wait(milliseconds: number, signal: AbortSignal): Promise<void>;
}

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

        const backoffMilliseconds = initialProviderRetryDelayMilliseconds * 2 ** retries;
        retries += 1;
        await this.delay.wait(backoffMilliseconds, signal);
      }
    }
  }
}

function isRetryableProviderError(error: unknown): error is ModelGatewayError {
  return (
    error instanceof ModelGatewayError &&
    (error.code === "rate-limit" || error.code === "unavailable")
  );
}
