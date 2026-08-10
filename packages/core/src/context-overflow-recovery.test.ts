import { describe, expect, it, vi } from "vitest";

import {
  ContextOverflowRecoveryExhaustedError,
  type ContextRecoveryRetry,
  type ContextRecoveryRetryResult,
  type ModelMessage,
  type ModelMessageTokenCounter,
  maxContextOverflowRecoveryAttempts,
  recoverFromContextOverflow,
} from "./index.js";

const oneTokenPerMessage: ModelMessageTokenCounter = { count: () => 1 };

describe("Context Overflow Recovery", () => {
  it("recovers on the first retry after pruning", async () => {
    const messages = history();
    const retry = scriptedRetry<string>([{ outcome: "success", value: "accepted" }]);

    await expect(
      recoverFromContextOverflow(
        { messages, maxHistoryTokens: 5 },
        { tokenCounter: oneTokenPerMessage, retry },
        new AbortController().signal,
      ),
    ).resolves.toEqual({
      value: "accepted",
      messages: [messages[0], ...messages.slice(2)],
      estimatedTokens: 5,
      attempts: 1,
    });
    expect(retry.retry).toHaveBeenCalledOnce();
  });

  it("stops after one retry and defers summary recovery", async () => {
    const retry = scriptedRetry<string>([
      { outcome: "overflow" },
      { outcome: "success", value: "must not run" },
    ]);

    await expect(
      recoverFromContextOverflow(
        { messages: history(), maxHistoryTokens: 5 },
        { tokenCounter: oneTokenPerMessage, retry },
        new AbortController().signal,
      ),
    ).rejects.toEqual(
      new ContextOverflowRecoveryExhaustedError(maxContextOverflowRecoveryAttempts, "retry-limit"),
    );
    expect(maxContextOverflowRecoveryAttempts).toBe(1);
    expect(retry.retry).toHaveBeenCalledOnce();
  });

  it("does not retry when pruning cannot strictly reduce input", async () => {
    const retry = scriptedRetry([]);

    await expect(
      recoverFromContextOverflow(
        {
          messages: [text("system", "rules"), text("user", "current")],
          maxHistoryTokens: 2,
        },
        { tokenCounter: oneTokenPerMessage, retry },
        new AbortController().signal,
      ),
    ).rejects.toEqual(new ContextOverflowRecoveryExhaustedError(0, "no-reduction"));
    expect(retry.retry).not.toHaveBeenCalled();
  });

  it("propagates cancellation without starting another recovery step", async () => {
    const controller = new AbortController();
    const cancellation = new Error("cancel recovery");
    const retry: ContextRecoveryRetry<string> = {
      retry: vi.fn(async () => {
        controller.abort(cancellation);
        return { outcome: "overflow" };
      }),
    };

    await expect(
      recoverFromContextOverflow(
        { messages: history(), maxHistoryTokens: 5 },
        { tokenCounter: oneTokenPerMessage, retry },
        controller.signal,
      ),
    ).rejects.toBe(cancellation);
    expect(retry.retry).toHaveBeenCalledOnce();
  });
});

function history(): readonly ModelMessage[] {
  return [
    text("system", "rules"),
    text("user", "old request one"),
    text("assistant", "old answer one"),
    text("user", "old request two"),
    text("assistant", "old answer two"),
    text("user", "current request"),
  ];
}

function text(role: "system" | "user" | "assistant", content: string): ModelMessage {
  return { role, content };
}

function scriptedRetry<Result>(results: readonly ContextRecoveryRetryResult<Result>[]) {
  let nextResult = 0;
  return {
    retry: vi.fn(async () => {
      const result = results[nextResult];
      nextResult += 1;
      if (result === undefined) {
        throw new Error("Recovery retry script exhausted.");
      }
      return result;
    }),
  } satisfies ContextRecoveryRetry<Result>;
}
