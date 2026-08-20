import type { StructuredLogger } from "./structured-logger.js";

interface PerformanceBaselineDependencies {
  readonly startedAt: number;
  readonly now: () => number;
  readonly readRssBytes: () => number;
  readonly logger: Pick<StructuredLogger, "info">;
}

export interface PerformanceBaselineSnapshot {
  readonly activationDurationMs: number;
  readonly firstWebviewDisplayDurationMs?: number;
  readonly memoryBytes: number;
}

export type PerformanceBaselineSample = PerformanceBaselineSnapshot;

export class PerformanceBaselineRecorder {
  readonly #startedAt: number;
  readonly #now: () => number;
  readonly #readRssBytes: () => number;
  readonly #logger: Pick<StructuredLogger, "info">;
  readonly #onSample?: (sample: PerformanceBaselineSample) => void;
  #firstDisplayRecorded = false;
  #activationDurationMs = 0;
  #firstWebviewDisplayDurationMs: number | undefined;

  constructor({
    startedAt,
    now,
    readRssBytes,
    logger,
    onSample,
  }: PerformanceBaselineDependencies & {
    readonly onSample?: (sample: PerformanceBaselineSample) => void;
  }) {
    this.#startedAt = normalizeInteger(startedAt);
    this.#now = now;
    this.#readRssBytes = readRssBytes;
    this.#logger = logger;
    this.#onSample = onSample;
  }

  recordActivationComplete(): void {
    this.#activationDurationMs = this.#elapsedMilliseconds();
    this.#logger.info({
      event: "extension_activated",
      component: "extension",
      outcome: "success",
      durationMs: this.#activationDurationMs,
    });
    this.#logger.info({
      event: "extension_idle_memory_sampled",
      component: "extension",
      outcome: "success",
      memoryBytes: normalizeInteger(this.#readRssBytes()),
    });
    this.#onSample?.(this.getSnapshot());
  }

  recordFirstWebviewDisplay(): void {
    if (this.#firstDisplayRecorded) {
      return;
    }

    this.#firstDisplayRecorded = true;
    this.#firstWebviewDisplayDurationMs = this.#elapsedMilliseconds();
    this.#logger.info({
      event: "agent_view_first_displayed",
      component: "agent_view",
      outcome: "success",
      durationMs: this.#firstWebviewDisplayDurationMs,
    });
    this.#onSample?.(this.getSnapshot());
  }

  getSnapshot(): PerformanceBaselineSnapshot {
    return {
      activationDurationMs: this.#activationDurationMs,
      ...(this.#firstWebviewDisplayDurationMs === undefined
        ? {}
        : { firstWebviewDisplayDurationMs: this.#firstWebviewDisplayDurationMs }),
      memoryBytes: normalizeInteger(this.#readRssBytes()),
    };
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
