import { describe, expect, it } from "vitest";

import {
  type SessionSummary,
  sessionIdSchema,
  sessionStatusSchema,
  sessionSummarySchema,
} from "./index.js";

describe("Session DTO", () => {
  const validSession = {
    sessionId: "session-1",
    status: "idle",
    createdAt: "2026-07-15T10:30:00+08:00",
  } satisfies SessionSummary;

  it("round-trips a valid session summary through JSON", () => {
    expect(sessionSummarySchema.parse(JSON.parse(JSON.stringify(validSession)) as unknown)).toEqual(
      validSession,
    );
  });

  it.each([
    { status: validSession.status, createdAt: validSession.createdAt },
    { sessionId: validSession.sessionId, createdAt: validSession.createdAt },
    { sessionId: validSession.sessionId, status: validSession.status },
    { ...validSession, sessionId: "" },
    { ...validSession, sessionId: "x".repeat(129) },
    { ...validSession, status: "running" },
    { ...validSession, createdAt: "2026-07-15T10:30:00" },
    { ...validSession, createdAt: "not-a-date" },
    { ...validSession, unexpected: true },
  ])("rejects an invalid session summary %#", (session) => {
    expect(sessionSummarySchema.safeParse(session).success).toBe(false);
  });

  it("accepts every defined session status", () => {
    expect(
      [
        "idle",
        "preparing",
        "streaming",
        "awaiting_approval",
        "executing_tool",
        "completed",
        "cancelled",
        "failed",
        "interrupted",
      ].map((status) => sessionStatusSchema.parse(status)),
    ).toHaveLength(9);
  });

  it("validates session identifiers independently", () => {
    expect(sessionIdSchema.parse(validSession.sessionId)).toBe(validSession.sessionId);
    expect(sessionIdSchema.safeParse(42).success).toBe(false);
  });
});
