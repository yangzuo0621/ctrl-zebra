import { describe, expect, it } from "vitest";

import {
  maxReasoningBlockCodePoints,
  measureReasoningText,
  reasoningDeltaTextSchema,
  restoredReasoningSchema,
  takeReasoningTextPrefix,
} from "./index.js";

describe("reasoning text boundaries", () => {
  it("measures Unicode code points and UTF-8 bytes without splitting surrogate pairs", () => {
    expect(measureReasoningText("a😀会")).toEqual({ codePoints: 3, utf8Bytes: 8 });
    expect(measureReasoningText("\ud800")).toBeUndefined();
  });

  it("takes the largest prefix that fits both budgets with deterministic reasons", () => {
    expect(takeReasoningTextPrefix("aa😀", 2, 100)).toEqual({
      text: "aa",
      measurement: { codePoints: 2, utf8Bytes: 2 },
      complete: false,
      reason: "code-points",
    });
    expect(takeReasoningTextPrefix("aa😀", 10, 2)).toEqual({
      text: "aa",
      measurement: { codePoints: 2, utf8Bytes: 2 },
      complete: false,
      reason: "utf8-bytes",
    });
  });

  it("rejects empty, ill-formed, and oversized deltas", () => {
    expect(reasoningDeltaTextSchema.safeParse("").success).toBe(false);
    expect(reasoningDeltaTextSchema.safeParse("\udfff").success).toBe(false);
    expect(reasoningDeltaTextSchema.safeParse("x".repeat(8_193)).success).toBe(false);
    expect(reasoningDeltaTextSchema.safeParse("😀".repeat(8_193)).success).toBe(false);
  });

  it("rejects duplicate blocks and aggregate restored content beyond the run limit", () => {
    const block = {
      blockId: "reasoning-1",
      startSequence: 1,
      endSequence: 3,
      content: "x",
      state: "complete",
      truncated: false,
    } as const;
    expect(
      restoredReasoningSchema.safeParse({
        sessionId: "session-1",
        blocks: [block, { ...block, startSequence: 4, endSequence: 5 }],
        runTruncated: false,
      }).success,
    ).toBe(false);

    expect(
      restoredReasoningSchema.safeParse({
        sessionId: "session-1",
        blocks: [1, 2, 3].map((index) => ({
          blockId: `reasoning-${index}`,
          startSequence: index * 2 - 1,
          endSequence: index * 2,
          content: "x".repeat(maxReasoningBlockCodePoints),
          state: "complete",
          truncated: false,
        })),
        runTruncated: true,
      }).success,
    ).toBe(false);
  });
});
