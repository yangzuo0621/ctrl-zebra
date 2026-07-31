import { describe, expect, it } from "vitest";

import {
  extensionToWebviewMessageSchema,
  protocolVersion,
  reasoningRestoredMessageSchema,
} from "./index.js";

describe("reasoning protocol messages", () => {
  it("round-trips the live lifecycle and structured limit variants", () => {
    const messages = [
      {
        protocolVersion,
        type: "extension/reasoning-start",
        requestId: "request-1",
        blockId: "reasoning-1",
      },
      {
        protocolVersion,
        type: "extension/reasoning-delta",
        requestId: "request-1",
        blockId: "reasoning-1",
        text: "Check facts.",
      },
      {
        protocolVersion,
        type: "extension/reasoning-limit",
        requestId: "request-1",
        scope: "block",
        blockId: "reasoning-1",
        reason: "utf8-bytes",
      },
      {
        protocolVersion,
        type: "extension/reasoning-limit",
        requestId: "request-1",
        scope: "run",
        reason: "block-count",
      },
      {
        protocolVersion,
        type: "extension/reasoning-end",
        requestId: "request-1",
        blockId: "reasoning-1",
        truncated: true,
      },
    ] as const;

    for (const message of messages) {
      expect(
        extensionToWebviewMessageSchema.parse(JSON.parse(JSON.stringify(message)) as unknown),
      ).toEqual(message);
    }
  });

  it("round-trips complete and partial restored blocks", () => {
    const message = {
      protocolVersion,
      type: "extension/reasoning-restored",
      requestId: "restore-1",
      sessionId: "session-1",
      blocks: [
        {
          blockId: "reasoning-1",
          startSequence: 2,
          endSequence: 4,
          content: "Complete",
          state: "complete",
          truncated: false,
        },
        {
          blockId: "reasoning-2",
          startSequence: 6,
          content: "Partial",
          state: "partial",
          truncated: false,
        },
      ],
      runTruncated: false,
    } as const;

    expect(reasoningRestoredMessageSchema.parse(message)).toEqual(message);
  });

  it.each([
    {
      type: "extension/reasoning-start",
      blockId: "",
    },
    {
      type: "extension/reasoning-delta",
      blockId: "reasoning-1",
      text: "",
    },
    {
      type: "extension/reasoning-delta",
      blockId: "reasoning-1",
      text: "x".repeat(8_193),
    },
    {
      type: "extension/reasoning-end",
      blockId: "reasoning-1",
    },
    {
      type: "extension/reasoning-limit",
      scope: "block",
      reason: "block-count",
      blockId: "reasoning-1",
    },
    {
      type: "extension/reasoning-limit",
      scope: "run",
      reason: "code-points",
      blockId: "reasoning-1",
    },
    {
      type: "extension/reasoning-start",
      blockId: "reasoning-1",
      providerMetadata: {},
    },
  ])("rejects malformed or overprivileged live messages %#", (payload) => {
    expect(
      extensionToWebviewMessageSchema.safeParse({
        protocolVersion,
        requestId: "request-1",
        ...payload,
      }).success,
    ).toBe(false);
  });

  it("rejects restored content beyond the aggregate run boundary", () => {
    expect(
      reasoningRestoredMessageSchema.safeParse({
        protocolVersion,
        type: "extension/reasoning-restored",
        requestId: "restore-1",
        sessionId: "session-1",
        blocks: [1, 2, 3].map((index) => ({
          blockId: `reasoning-${index}`,
          startSequence: index * 2 - 1,
          endSequence: index * 2,
          content: "x".repeat(32_768),
          state: "complete",
          truncated: false,
        })),
        runTruncated: true,
      }).success,
    ).toBe(false);
  });

  it("rejects overlapping blocks and a block following a partial restore", () => {
    const complete = {
      blockId: "reasoning-1",
      startSequence: 2,
      endSequence: 5,
      content: "First",
      state: "complete",
      truncated: false,
    } as const;
    const envelope = {
      protocolVersion,
      type: "extension/reasoning-restored",
      requestId: "restore-1",
      sessionId: "session-1",
      runTruncated: false,
    } as const;

    expect(
      reasoningRestoredMessageSchema.safeParse({
        ...envelope,
        blocks: [
          complete,
          {
            ...complete,
            blockId: "reasoning-2",
            startSequence: 4,
            endSequence: 6,
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      reasoningRestoredMessageSchema.safeParse({
        ...envelope,
        blocks: [
          {
            blockId: "reasoning-partial",
            startSequence: 2,
            content: "Partial",
            state: "partial",
            truncated: false,
          },
          {
            ...complete,
            blockId: "reasoning-after-partial",
            startSequence: 6,
            endSequence: 7,
          },
        ],
      }).success,
    ).toBe(false);
  });
});
