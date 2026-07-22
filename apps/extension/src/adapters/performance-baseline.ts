import type { StructuredLogger } from "./structured-logger.js";

interface PerformanceBaselineDependencies {
  readonly startedAt: number;
  readonly now: () => number;
  readonly readRssBytes: () => number;
  readonly logger: Pick<StructuredLogger, "info">;
}

export class PerformanceBaselineRecorder {
  readonly #startedAt: number;
  readonly #now: () => number;
  readonly #readRssBytes: () => number;
  readonly #logger: Pick<StructuredLogger, "info">;
  #firstDisplayRecorded = false;

  constructor({ startedAt, now, readRssBytes, logger }: PerformanceBaselineDependencies) {
    this.#startedAt = normalizeInteger(startedAt);
    this.#now = now;
    this.#readRssBytes = readRssBytes;
    this.#logger = logger;
  }

  recordActivationComplete(): void {
    this.#logger.info({
      event: "extension_activated",
      component: "extension",
      outcome: "success",
      durationMs: this.#elapsedMilliseconds(),
    });
    this.#logger.info({
      event: "extension_idle_memory_sampled",
      component: "extension",
      outcome: "success",
      memoryBytes: normalizeInteger(this.#readRssBytes()),
    });
  }

  recordFirstWebviewDisplay(): void {
    if (this.#firstDisplayRecorded) {
      return;
    }

    this.#firstDisplayRecorded = true;
    this.#logger.info({
      event: "agent_view_first_displayed",
      component: "agent_view",
      outcome: "success",
      durationMs: this.#elapsedMilliseconds(),
    });
  }

  #elapsedMilliseconds(): number {
    return Math.max(0, normalizeInteger(this.#now()) - this.#startedAt);
  }
}

function normalizeInteger(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return Math.min(Number.MAX_SAFE_INTEGER, Math.round(value));
}
