import { describe, expect, it } from "vitest";
import {
  HeuristicModelMessageTokenCounter,
  heuristicBytesPerToken,
  heuristicMessageOverheadTokens,
  maxHeuristicSerializedBytes,
} from "./heuristic-token-counter.js";
import type { ModelMessage } from "./model-gateway.js";
import { utf8ByteLength } from "./text-primitives.js";
import { maxModelContextWindowTokens } from "./token-budget.js";

const counter = new HeuristicModelMessageTokenCounter();

describe("HeuristicModelMessageTokenCounter", () => {
  it("counts an ASCII message from its UTF-8 JSON bytes plus framing", () => {
    const message = { role: "user", content: "Hello, CtrlZebra." } as const;

    expect(counter.count(message)).toBe(
      Math.ceil(utf8ByteLength(JSON.stringify(message)) / heuristicBytesPerToken) +
        heuristicMessageOverheadTokens,
    );
  });

  it("does not severely undercount CJK text", () => {
    const ascii = counter.count({ role: "user", content: "a".repeat(32) });
    const cjk = counter.count({ role: "user", content: "界".repeat(32) });

    expect(cjk).toBeGreaterThan(ascii);
    expect(cjk).toBe(
      Math.ceil(utf8ByteLength(JSON.stringify({ role: "user", content: "界".repeat(32) })) / 4) +
        heuristicMessageOverheadTokens,
    );
  });

  it("retains the message envelope when content is empty", () => {
    const message = { role: "assistant", content: "" } as const;

    expect(counter.count(message)).toBe(
      Math.ceil(utf8ByteLength(JSON.stringify(message)) / heuristicBytesPerToken) +
        heuristicMessageOverheadTokens,
    );
    expect(counter.count(message)).toBeGreaterThan(heuristicMessageOverheadTokens);
  });

  it("includes Tool names, arguments, and results in the estimate", () => {
    const call: ModelMessage = {
      role: "assistant",
      toolCall: {
        id: "call-1",
        name: "read_file",
        input: { path: "src/index.ts", line: 12, labels: ["界", "source"] },
      },
    };
    const result: ModelMessage = {
      role: "tool",
      result: {
        callId: "call-1",
        name: "read_file",
        status: "success",
        output: { text: "export const answer = 42;" },
        truncated: false,
      },
    };

    expect(counter.count(call)).toBe(
      Math.ceil(utf8ByteLength(JSON.stringify(call)) / heuristicBytesPerToken) +
        heuristicMessageOverheadTokens,
    );
    expect(counter.count(result)).toBe(
      Math.ceil(utf8ByteLength(JSON.stringify(result)) / heuristicBytesPerToken) +
        heuristicMessageOverheadTokens,
    );
    expect(counter.count(call)).toBeGreaterThan(counter.count({ role: "assistant", content: "" }));
  });

  it("is deterministic for equivalent Tool JSON with different key insertion order", () => {
    const first: ModelMessage = {
      role: "assistant",
      toolCall: { id: "call-1", name: "read_file", input: { path: "a", line: 1 } },
    };
    const second: ModelMessage = {
      role: "assistant",
      toolCall: { id: "call-1", name: "read_file", input: { line: 1, path: "a" } },
    };

    expect(counter.count(first)).toBe(counter.count(second));
    expect(counter.count(first)).toBe(counter.count(first));
  });

  it("caps serialization and counting at one model context window", () => {
    const message = { role: "user", content: "x".repeat(maxHeuristicSerializedBytes * 2) } as const;

    expect(counter.count(message)).toBe(maxModelContextWindowTokens);
  });

  it("fits exactly at the estimated budget and reports the one-token boundary", () => {
    const message = { role: "user", content: "budget boundary" } as const;
    const estimated = counter.count(message);

    expect(estimated).toBeGreaterThan(0);
    expect(estimated).toBe(
      Math.ceil(utf8ByteLength(JSON.stringify(message)) / heuristicBytesPerToken) +
        heuristicMessageOverheadTokens,
    );
  });
});
