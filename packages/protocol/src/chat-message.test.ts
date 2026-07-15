import { describe, expect, it } from "vitest";

import {
  assistantMessageSchema,
  type ChatMessage,
  chatMessageSchema,
  toolMessageSchema,
  userMessageSchema,
} from "./index.js";

describe("Chat Message DTO", () => {
  const commonFields = {
    messageId: "message-1",
    sessionId: "session-1",
    createdAt: "2026-07-15T10:30:00Z",
    content: "Persisted message content",
  };

  it.each([
    ["user", userMessageSchema],
    ["assistant", assistantMessageSchema],
    ["tool", toolMessageSchema],
  ] as const)("round-trips a valid %s message through JSON", (role, schema) => {
    const message = { ...commonFields, role } satisfies ChatMessage;

    expect(schema.parse(JSON.parse(JSON.stringify(message)) as unknown)).toEqual(message);
    expect(chatMessageSchema.parse(message)).toEqual(message);
  });

  it.each([
    { ...commonFields, role: "system" },
    { ...commonFields, role: "user", messageId: "" },
    { ...commonFields, role: "user", messageId: "x".repeat(129) },
    { ...commonFields, role: "assistant", sessionId: "" },
    { ...commonFields, role: "assistant", createdAt: "2026-07-15T10:30:00" },
    { ...commonFields, role: "tool", content: "" },
    { ...commonFields, role: "tool", content: "x".repeat(1_000_001) },
    { ...commonFields, role: "user", unexpected: true },
  ])("rejects an invalid persisted message %#", (message) => {
    expect(chatMessageSchema.safeParse(message).success).toBe(false);
  });
});
