import { describe, expect, it } from "vitest";

import {
  conversationSummaryKind,
  conversationSummaryVersion,
  InvalidConversationSummaryError,
  maxConversationSummaryCharacters,
  parseConversationSummary,
} from "./index.js";

const validSummary = {
  kind: conversationSummaryKind,
  version: conversationSummaryVersion,
  coveredMessageRange: { startMessageIndex: 0, endMessageIndexExclusive: 4 },
  content: "The user requested a bounded implementation; validation remains unresolved.",
} as const;

describe("Conversation Summarizer contract", () => {
  it("round-trips a persistable summary through JSON", () => {
    const persisted = JSON.parse(JSON.stringify(validSummary)) as unknown;

    expect(parseConversationSummary(persisted)).toEqual(validSummary);
  });

  it("counts Unicode code points instead of UTF-16 code units", () => {
    const exact = { ...validSummary, content: "😀".repeat(maxConversationSummaryCharacters) };

    expect(parseConversationSummary(exact)).toEqual(exact);
    expect(() => parseConversationSummary({ ...exact, content: `${exact.content}x` })).toThrow(
      InvalidConversationSummaryError,
    );
  });

  it.each([
    { ...validSummary, content: "" },
    { ...validSummary, content: "\ud800" },
    { ...validSummary, kind: "system-summary" },
    { ...validSummary, version: 2 },
    {
      ...validSummary,
      coveredMessageRange: { startMessageIndex: -1, endMessageIndexExclusive: 4 },
    },
    { ...validSummary, coveredMessageRange: { startMessageIndex: 4, endMessageIndexExclusive: 4 } },
    { ...validSummary, coveredMessageRange: { startMessageIndex: 4, endMessageIndexExclusive: 3 } },
    {
      ...validSummary,
      coveredMessageRange: { startMessageIndex: 0.5, endMessageIndexExclusive: 4 },
    },
    { ...validSummary, unexpected: true },
    { ...validSummary, coveredMessageRange: { ...validSummary.coveredMessageRange, extra: true } },
  ])("rejects an invalid summary %#", (value) => {
    expect(() => parseConversationSummary(value)).toThrow(InvalidConversationSummaryError);
  });
});
