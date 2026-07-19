import { describe, expect, it, vi } from "vitest";

import {
  ContextOverflowRecoveryExhaustedError,
  type ContextRecoveryRetry,
  type ContextRecoveryRetryResult,
  type ConversationSummarizer,
  conversationSummaryKind,
  conversationSummaryMessagePrefix,
  conversationSummaryVersion,
  InvalidContextRecoverySummaryError,
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
    const summarizer = unusedSummarizer();

    await expect(
      recoverFromContextOverflow(
        { messages, maxHistoryTokens: 5, summaryRange: range(1, 5) },
        { tokenCounter: oneTokenPerMessage, summarizer, retry },
        new AbortController().signal,
      ),
    ).resolves.toEqual({
      value: "accepted",
      messages: [messages[0], ...messages.slice(2)],
      estimatedTokens: 5,
      attempts: 1,
    });
    expect(retry.retry).toHaveBeenCalledOnce();
    expect(summarizer.summarize).not.toHaveBeenCalled();
  });

  it("recovers on the second retry after one summary", async () => {
    const messages = history();
    const retry = scriptedRetry<string>([
      { outcome: "overflow" },
      { outcome: "success", value: "accepted" },
    ]);
    const summarizer = scriptedSummarizer(
      "Older requests and answers were summarized.",
      range(1, 5),
    );

    const result = await recoverFromContextOverflow(
      { messages, maxHistoryTokens: 5, summaryRange: range(1, 5) },
      { tokenCounter: oneTokenPerMessage, summarizer, retry },
      new AbortController().signal,
    );

    expect(result).toMatchObject({
      value: "accepted",
      estimatedTokens: 3,
      attempts: maxContextOverflowRecoveryAttempts,
      summary: { coveredMessageRange: range(1, 5) },
    });
    expect(result.messages).toEqual([
      messages[0],
      {
        role: "user",
        content: `${conversationSummaryMessagePrefix}\nOlder requests and answers were summarized.`,
      },
      messages[5],
    ]);
    expect(retry.retry).toHaveBeenCalledTimes(maxContextOverflowRecoveryAttempts);
    expect(summarizer.summarize).toHaveBeenCalledOnce();
  });

  it("stops after the maximum retry count", async () => {
    const retry = scriptedRetry([{ outcome: "overflow" }, { outcome: "overflow" }]);
    const summarizer = scriptedSummarizer("Summary", range(1, 5));

    await expect(
      recoverFromContextOverflow(
        { messages: history(), maxHistoryTokens: 5, summaryRange: range(1, 5) },
        { tokenCounter: oneTokenPerMessage, summarizer, retry },
        new AbortController().signal,
      ),
    ).rejects.toEqual(
      new ContextOverflowRecoveryExhaustedError(maxContextOverflowRecoveryAttempts, "retry-limit"),
    );
    expect(retry.retry).toHaveBeenCalledTimes(maxContextOverflowRecoveryAttempts);
    expect(summarizer.summarize).toHaveBeenCalledOnce();
  });

  it("does not retry when pruning cannot strictly reduce input", async () => {
    const retry = scriptedRetry([]);
    const summarizer = unusedSummarizer();

    await expect(
      recoverFromContextOverflow(
        {
          messages: [text("system", "rules"), text("user", "current")],
          maxHistoryTokens: 2,
          summaryRange: range(0, 1),
        },
        { tokenCounter: oneTokenPerMessage, summarizer, retry },
        new AbortController().signal,
      ),
    ).rejects.toEqual(new ContextOverflowRecoveryExhaustedError(0, "no-reduction"));
    expect(retry.retry).not.toHaveBeenCalled();
    expect(summarizer.summarize).not.toHaveBeenCalled();
  });

  it("does not run a second retry when summarization cannot strictly reduce input", async () => {
    const retry = scriptedRetry([{ outcome: "overflow" }]);
    const summarizer = scriptedSummarizer("Summary", range(1, 5));
    const tokenCounter: ModelMessageTokenCounter = {
      count: (message) =>
        "content" in message && message.content.startsWith(conversationSummaryMessagePrefix)
          ? 3
          : 1,
    };

    await expect(
      recoverFromContextOverflow(
        { messages: history(), maxHistoryTokens: 5, summaryRange: range(1, 5) },
        { tokenCounter, summarizer, retry },
        new AbortController().signal,
      ),
    ).rejects.toEqual(new ContextOverflowRecoveryExhaustedError(1, "no-reduction"));
    expect(retry.retry).toHaveBeenCalledOnce();
    expect(summarizer.summarize).toHaveBeenCalledOnce();
  });

  it("rejects a summary range that splits a Tool Call/Result pair", async () => {
    const pair = toolPair();
    const messages = [
      text("system", "rules"),
      text("assistant", "optional"),
      pair.call,
      pair.result,
      text("assistant", "more optional"),
      text("user", "current"),
    ];
    const retry = scriptedRetry([{ outcome: "overflow" }]);

    await expect(
      recoverFromContextOverflow(
        { messages, maxHistoryTokens: 5, summaryRange: range(3, 5) },
        { tokenCounter: oneTokenPerMessage, summarizer: unusedSummarizer(), retry },
        new AbortController().signal,
      ),
    ).rejects.toEqual(new InvalidContextRecoverySummaryError("range"));
    expect(retry.retry).toHaveBeenCalledOnce();
  });

  it("rejects a summary whose covered range does not match the request", async () => {
    const retry = scriptedRetry([{ outcome: "overflow" }]);

    await expect(
      recoverFromContextOverflow(
        { messages: history(), maxHistoryTokens: 5, summaryRange: range(1, 5) },
        {
          tokenCounter: oneTokenPerMessage,
          summarizer: scriptedSummarizer("Summary", range(1, 4)),
          retry,
        },
        new AbortController().signal,
      ),
    ).rejects.toEqual(new InvalidContextRecoverySummaryError("mismatch"));
    expect(retry.retry).toHaveBeenCalledOnce();
  });

  it("propagates cancellation without starting summary recovery", async () => {
    const controller = new AbortController();
    const cancellation = new Error("cancel recovery");
    const summarizer = unusedSummarizer();
    const retry: ContextRecoveryRetry<string> = {
      retry: vi.fn(async () => {
        controller.abort(cancellation);
        return { outcome: "overflow" };
      }),
    };

    await expect(
      recoverFromContextOverflow(
        { messages: history(), maxHistoryTokens: 5, summaryRange: range(1, 5) },
        { tokenCounter: oneTokenPerMessage, summarizer, retry },
        controller.signal,
      ),
    ).rejects.toBe(cancellation);
    expect(retry.retry).toHaveBeenCalledOnce();
    expect(summarizer.summarize).not.toHaveBeenCalled();
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

function range(startMessageIndex: number, endMessageIndexExclusive: number) {
  return { startMessageIndex, endMessageIndexExclusive };
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

function scriptedSummarizer(
  content: string,
  coveredMessageRange: {
    readonly startMessageIndex: number;
    readonly endMessageIndexExclusive: number;
  },
): ConversationSummarizer {
  return {
    summarize: vi.fn(async () => ({
      kind: conversationSummaryKind,
      version: conversationSummaryVersion,
      coveredMessageRange,
      content,
    })),
  };
}

function unusedSummarizer(): ConversationSummarizer {
  return {
    summarize: vi.fn(async () => {
      throw new Error("Unexpected summary request.");
    }),
  };
}

function toolPair() {
  return {
    call: {
      role: "assistant",
      toolCall: { id: "call-1", name: "list_files", input: null },
    },
    result: {
      role: "tool",
      result: {
        callId: "call-1",
        name: "list_files",
        status: "success",
        output: null,
        truncated: false,
      },
    },
  } as const satisfies { readonly call: ModelMessage; readonly result: ModelMessage };
}
