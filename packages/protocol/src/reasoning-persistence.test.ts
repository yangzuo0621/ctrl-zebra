import { describe, expect, it } from "vitest";

import { persistedEventRecordSchema, persistedReasoningEventPayloadSchema } from "./index.js";

describe("persisted reasoning events", () => {
  it("round-trips every additive version 1 reasoning event", () => {
    const events = [
      { type: "session.reasoning-start", data: { blockId: "reasoning-1" } },
      {
        type: "session.reasoning-delta",
        data: { blockId: "reasoning-1", text: "Inspect." },
      },
      {
        type: "session.reasoning-limit",
        data: {
          scope: "block",
          blockId: "reasoning-1",
          reason: "code-points",
        },
      },
      {
        type: "session.reasoning-end",
        data: { blockId: "reasoning-1", truncated: true },
      },
    ] as const;

    for (const event of events) {
      expect(persistedReasoningEventPayloadSchema.parse(event)).toEqual(event);
    }
  });

  it.each([
    { type: "session.reasoning-start", data: {} },
    {
      type: "session.reasoning-delta",
      data: { blockId: "reasoning-1", text: "", metadata: {} },
    },
    {
      type: "session.reasoning-end",
      data: { blockId: "reasoning-1", truncated: "yes" },
    },
    {
      type: "session.reasoning-limit",
      data: { scope: "run", reason: "block-count", blockId: "reasoning-1" },
    },
  ])("rejects malformed recognized reasoning payloads %#", (event) => {
    expect(
      persistedEventRecordSchema.safeParse({
        sequence: 1,
        recordedAt: "2026-07-31T00:00:00.000Z",
        event,
      }).success,
    ).toBe(false);
  });

  it("continues to admit unrelated additive dotted event types", () => {
    expect(
      persistedEventRecordSchema.safeParse({
        sequence: 1,
        recordedAt: "2026-07-31T00:00:00.000Z",
        event: { type: "session.future-event", data: { value: true } },
      }).success,
    ).toBe(true);
  });
});
