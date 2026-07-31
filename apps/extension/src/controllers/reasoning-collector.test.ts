import type { AgentRuntimeEvent } from "@ctrl-zebra/core";
import { describe, expect, it } from "vitest";

import { ReasoningCollector } from "./reasoning-collector.js";

describe("ReasoningCollector", () => {
  it("preserves valid multiple-block lifecycles and the associated Session", () => {
    const collector = new ReasoningCollector("session-1");
    const output = [
      ...accept(collector, "agent.reasoning-start", "reasoning-1"),
      ...accept(collector, "agent.reasoning-delta", "reasoning-1", "First"),
      ...accept(collector, "agent.reasoning-end", "reasoning-1"),
      ...accept(collector, "agent.reasoning-start", "reasoning-2"),
      ...accept(collector, "agent.reasoning-delta", "reasoning-2", "Second"),
      ...accept(collector, "agent.reasoning-end", "reasoning-2"),
    ];

    expect(output).toEqual([
      {
        type: "session.reasoning-start",
        sessionId: "session-1",
        blockId: "reasoning-1",
      },
      {
        type: "session.reasoning-delta",
        sessionId: "session-1",
        blockId: "reasoning-1",
        text: "First",
      },
      {
        type: "session.reasoning-end",
        sessionId: "session-1",
        blockId: "reasoning-1",
        truncated: false,
      },
      {
        type: "session.reasoning-start",
        sessionId: "session-1",
        blockId: "reasoning-2",
      },
      {
        type: "session.reasoning-delta",
        sessionId: "session-1",
        blockId: "reasoning-2",
        text: "Second",
      },
      {
        type: "session.reasoning-end",
        sessionId: "session-1",
        blockId: "reasoning-2",
        truncated: false,
      },
    ]);
  });

  it("bounds a block while collecting and reports UTF-8 precedence", () => {
    const collector = new ReasoningCollector("session-1");
    accept(collector, "agent.reasoning-start", "reasoning-1");
    for (let index = 0; index < 4; index += 1) {
      expect(
        accept(collector, "agent.reasoning-delta", "reasoning-1", "😀".repeat(8_192)),
      ).toHaveLength(1);
    }

    expect(accept(collector, "agent.reasoning-delta", "reasoning-1", "😀")).toEqual([
      {
        type: "session.reasoning-limit",
        sessionId: "session-1",
        scope: "block",
        blockId: "reasoning-1",
        reason: "utf8-bytes",
      },
    ]);
    expect(accept(collector, "agent.reasoning-delta", "reasoning-1", "discarded")).toEqual([]);
    expect(accept(collector, "agent.reasoning-end", "reasoning-1")).toEqual([
      {
        type: "session.reasoning-end",
        sessionId: "session-1",
        blockId: "reasoning-1",
        truncated: true,
      },
    ]);
  });

  it("reports simultaneous block and run limits in deterministic order", () => {
    const collector = new ReasoningCollector("session-1");
    for (const blockId of ["reasoning-1", "reasoning-2"]) {
      accept(collector, "agent.reasoning-start", blockId);
      for (let index = 0; index < 4; index += 1) {
        accept(collector, "agent.reasoning-delta", blockId, "x".repeat(8_192));
      }
      if (blockId === "reasoning-1") {
        accept(collector, "agent.reasoning-end", blockId);
      }
    }

    expect(accept(collector, "agent.reasoning-delta", "reasoning-2", "!")).toEqual([
      {
        type: "session.reasoning-limit",
        sessionId: "session-1",
        scope: "block",
        blockId: "reasoning-2",
        reason: "code-points",
      },
      {
        type: "session.reasoning-limit",
        sessionId: "session-1",
        scope: "run",
        reason: "code-points",
      },
    ]);
  });

  it("accepts at most 32 blocks and emits one run marker for later blocks", () => {
    const collector = new ReasoningCollector("session-1");
    for (let index = 1; index <= 32; index += 1) {
      const blockId = `reasoning-${index}`;
      accept(collector, "agent.reasoning-start", blockId);
      accept(collector, "agent.reasoning-end", blockId);
    }

    expect(accept(collector, "agent.reasoning-start", "reasoning-33")).toEqual([
      {
        type: "session.reasoning-limit",
        sessionId: "session-1",
        scope: "run",
        reason: "block-count",
      },
    ]);
    expect(accept(collector, "agent.reasoning-delta", "reasoning-33", "discarded")).toEqual([]);
    expect(accept(collector, "agent.reasoning-end", "reasoning-33")).toEqual([]);
    expect(accept(collector, "agent.reasoning-start", "reasoning-34")).toEqual([]);
  });

  it("ignores mismatched, malformed, and closed events without side effects", () => {
    const collector = new ReasoningCollector("session-1");
    expect(
      collector.accept({
        type: "agent.reasoning-start",
        sessionId: "session-other",
        blockId: "reasoning-1",
      }),
    ).toEqual([]);
    expect(accept(collector, "agent.reasoning-delta", "missing", "ignored")).toEqual([]);
    accept(collector, "agent.reasoning-start", "reasoning-1");
    expect(accept(collector, "agent.reasoning-start", "reasoning-2")).toEqual([]);
    collector.close();
    expect(accept(collector, "agent.reasoning-delta", "reasoning-1", "late")).toEqual([]);
    expect(accept(collector, "agent.reasoning-end", "reasoning-1")).toEqual([]);
  });
});

function accept(
  collector: ReasoningCollector,
  type: "agent.reasoning-start" | "agent.reasoning-end",
  blockId: string,
): ReturnType<ReasoningCollector["accept"]>;
function accept(
  collector: ReasoningCollector,
  type: "agent.reasoning-delta",
  blockId: string,
  text: string,
): ReturnType<ReasoningCollector["accept"]>;
function accept(
  collector: ReasoningCollector,
  type: "agent.reasoning-start" | "agent.reasoning-delta" | "agent.reasoning-end",
  blockId: string,
  text?: string,
): ReturnType<ReasoningCollector["accept"]> {
  const event =
    type === "agent.reasoning-delta"
      ? { type, sessionId: "session-1", blockId, text: text ?? "" }
      : { type, sessionId: "session-1", blockId };
  return collector.accept(event as Extract<AgentRuntimeEvent, { type: typeof type }>);
}
