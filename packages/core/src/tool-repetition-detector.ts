import { canonicalizeJson, type ToolCall, type ToolName } from "@ctrl-zebra/protocol";

export const defaultToolRepetitionThreshold = 3;
export const maxToolRepetitionThreshold = 10;

export interface ToolRepetitionObservation {
  readonly consecutiveCount: number;
  readonly thresholdReached: boolean;
}

export class ToolRepetitionDetectedError extends Error {
  constructor(
    readonly toolName: ToolName,
    readonly consecutiveCount: number,
    readonly threshold: number,
  ) {
    super(`Tool repetition threshold ${threshold} reached for "${toolName}".`);
    this.name = "ToolRepetitionDetectedError";
  }
}

export class ToolRepetitionDetector {
  readonly threshold: number;
  #previousFingerprint: string | undefined;
  #consecutiveCount = 0;

  constructor(threshold: number = defaultToolRepetitionThreshold) {
    if (
      !Number.isSafeInteger(threshold) ||
      threshold < 1 ||
      threshold > maxToolRepetitionThreshold
    ) {
      throw new RangeError(
        `tool repetition threshold must be a safe integer from 1 through ${maxToolRepetitionThreshold}.`,
      );
    }

    this.threshold = threshold;
  }

  observe(call: ToolCall): ToolRepetitionObservation {
    const fingerprint = `${call.name}\n${canonicalizeJson(call.input)}`;
    this.#consecutiveCount =
      fingerprint === this.#previousFingerprint ? this.#consecutiveCount + 1 : 1;
    this.#previousFingerprint = fingerprint;

    return {
      consecutiveCount: this.#consecutiveCount,
      thresholdReached: this.#consecutiveCount >= this.threshold,
    };
  }
}
