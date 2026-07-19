import { describe, expect, it } from "vitest";

import type { ModelMessage, ModelMessageTokenCounter } from "./index.js";
import {
  InvalidHistoryBudgetError,
  InvalidModelHistoryError,
  InvalidModelMessageTokenCountError,
  maxModelContextWindowTokens,
  pruneModelHistory,
} from "./index.js";

const oneTokenPerMessage: ModelMessageTokenCounter = { count: () => 1 };

describe("Model History Pruner", () => {
  it("returns the original history when it fits", () => {
    const messages = [text("system", "rules"), text("user", "request")];

    const result = pruneModelHistory(messages, 2, oneTokenPerMessage);

    expect(result).toEqual({
      messages,
      estimatedTokens: 2,
      pruned: false,
      overBudget: false,
    });
    expect(result.messages).toBe(messages);
  });

  it("accepts a zero-token budget when no protected content remains", () => {
    expect(pruneModelHistory([text("assistant", "optional")], 0, oneTokenPerMessage)).toEqual({
      messages: [],
      estimatedTokens: 0,
      pruned: true,
      overBudget: false,
    });
  });

  it("removes the oldest unprotected units first", () => {
    const messages = [
      text("system", "rules"),
      text("user", "old request"),
      text("assistant", "old answer"),
      text("user", "current request"),
      text("assistant", "current answer"),
    ];

    expect(pruneModelHistory(messages, 4, oneTokenPerMessage)).toEqual({
      messages: [messages[0], messages[2], messages[3], messages[4]],
      estimatedTokens: 4,
      pruned: true,
      overBudget: false,
    });
  });

  it("retains every System message and the latest user intent", () => {
    const messages = [
      text("system", "first rules"),
      text("user", "old request"),
      text("system", "additional rules"),
      text("assistant", "old answer"),
      text("user", "current request"),
    ];

    expect(pruneModelHistory(messages, 3, oneTokenPerMessage).messages).toEqual([
      messages[0],
      messages[2],
      messages[4],
    ]);
  });

  it("retains a complete non-adjacent Tool Call/Result pair when it fits", () => {
    const pair = toolPair("call-1", "list_files");
    const between = text("assistant", "working");
    const messages = [
      text("system", "rules"),
      text("user", "old request"),
      pair.call,
      between,
      pair.result,
      text("user", "current request"),
    ];

    expect(pruneModelHistory(messages, 5, oneTokenPerMessage).messages).toEqual([
      messages[0],
      pair.call,
      between,
      pair.result,
      messages[5],
    ]);
  });

  it("removes a Tool Call and its non-adjacent Result together", () => {
    const pair = toolPair("call-1", "list_files");
    const between = text("assistant", "working");
    const messages = [
      text("system", "rules"),
      text("user", "old request"),
      pair.call,
      between,
      pair.result,
      text("user", "current request"),
    ];

    expect(pruneModelHistory(messages, 3, oneTokenPerMessage).messages).toEqual([
      messages[0],
      between,
      messages[5],
    ]);
  });

  it.each([
    ["orphan result", [toolPair("call-1", "list_files").result]],
    ["unfinished call", [toolPair("call-1", "list_files").call]],
    [
      "mismatched name",
      [toolPair("call-1", "list_files").call, toolPair("call-1", "read_file").result],
    ],
    [
      "duplicate call ID",
      [toolPair("call-1", "list_files").call, toolPair("call-1", "read_file").call],
    ],
  ] as const)("rejects an invalid history with an %s", (_label, messages) => {
    expect(() => pruneModelHistory(messages, 10, oneTokenPerMessage)).toThrow(
      InvalidModelHistoryError,
    );
  });

  it("returns protected content explicitly over budget", () => {
    const messages = [
      text("system", "rules"),
      text("assistant", "optional"),
      text("user", "current request"),
    ];
    const counter: ModelMessageTokenCounter = {
      count: (message) => (message.role === "assistant" ? 1 : 3),
    };

    expect(pruneModelHistory(messages, 5, counter)).toEqual({
      messages: [messages[0], messages[2]],
      estimatedTokens: 6,
      pruned: true,
      overBudget: true,
    });
  });

  it.each([
    -1,
    1.5,
    Number.POSITIVE_INFINITY,
    maxModelContextWindowTokens + 1,
  ])("rejects an invalid history budget: %s", (maxTokens) => {
    expect(() => pruneModelHistory([], maxTokens, oneTokenPerMessage)).toThrow(
      InvalidHistoryBudgetError,
    );
  });

  it.each([
    -1,
    1.5,
    Number.POSITIVE_INFINITY,
    maxModelContextWindowTokens + 1,
    Number.MAX_SAFE_INTEGER + 1,
  ])("rejects an invalid token count: %s", (tokens) => {
    expect(() => pruneModelHistory([text("user", "request")], 10, { count: () => tokens })).toThrow(
      InvalidModelMessageTokenCountError,
    );
  });
});

function text(role: "system" | "user" | "assistant", content: string): ModelMessage {
  return { role, content };
}

function toolPair(callId: string, name: "list_files" | "read_file") {
  return {
    call: {
      role: "assistant",
      toolCall: { id: callId, name, input: null },
    },
    result: {
      role: "tool",
      result: {
        callId,
        name,
        status: "success",
        output: null,
        truncated: false,
      },
    },
  } as const satisfies { readonly call: ModelMessage; readonly result: ModelMessage };
}
