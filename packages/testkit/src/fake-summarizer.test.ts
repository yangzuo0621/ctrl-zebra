import {
  type ConversationSummary,
  conversationSummaryKind,
  conversationSummaryVersion,
  type SummarizeConversationRequest,
} from "@ctrl-zebra/core";
import { describe, expect, it } from "vitest";

import { FakeSummarizer, FakeSummarizerScriptExhaustedError } from "./index.js";

const request = {
  messages: [
    { role: "user", content: "Old request" },
    { role: "assistant", content: "Old answer" },
  ],
  coveredMessageRange: { startMessageIndex: 2, endMessageIndexExclusive: 4 },
} as const satisfies SummarizeConversationRequest;

const firstSummary = summary("First summary", 2, 4);
const secondSummary = summary("Second summary", 4, 6);

describe("FakeSummarizer", () => {
  it("returns scripted summaries in order and records requests", async () => {
    const summarizer = new FakeSummarizer([firstSummary, secondSummary]);
    const signal = new AbortController().signal;

    await expect(summarizer.summarize(request, signal)).resolves.toBe(firstSummary);
    await expect(summarizer.summarize(request, signal)).resolves.toBe(secondSummary);
    expect(summarizer.requests).toEqual([request, request]);
  });

  it("rejects an already-cancelled request without recording it", async () => {
    const summarizer = new FakeSummarizer([firstSummary]);
    const controller = new AbortController();
    const cancellation = new Error("cancel summary");
    controller.abort(cancellation);

    await expect(summarizer.summarize(request, controller.signal)).rejects.toBe(cancellation);
    expect(summarizer.requests).toEqual([]);
  });

  it("fails deterministically when the script is exhausted", async () => {
    const summarizer = new FakeSummarizer([]);

    await expect(summarizer.summarize(request, new AbortController().signal)).rejects.toEqual(
      new FakeSummarizerScriptExhaustedError(),
    );
    expect(summarizer.requests).toEqual([request]);
  });
});

function summary(
  content: string,
  startMessageIndex: number,
  endMessageIndexExclusive: number,
): ConversationSummary {
  return {
    kind: conversationSummaryKind,
    version: conversationSummaryVersion,
    coveredMessageRange: { startMessageIndex, endMessageIndexExclusive },
    content,
  };
}
