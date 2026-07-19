import { describe, expect, it } from "vitest";

import {
  getCheckpointPersistencePaths,
  getSessionPersistencePaths,
  maxPersistedCheckpointIdBytes,
  maxPersistedSessionIdBytes,
  persistedEventRecordSchema,
  persistedMessageRecordSchema,
  persistenceFormatVersion,
  type SessionManifest,
  sessionManifestSchema,
} from "./index.js";

describe("persistence format", () => {
  const manifest = {
    formatVersion: persistenceFormatVersion,
    sessionId: "session-1",
    status: "idle",
    createdAt: "2026-07-19T10:00:00+08:00",
    updatedAt: "2026-07-19T10:00:00+08:00",
    lastEventSequence: 0,
  } satisfies SessionManifest;

  it("parses the current manifest and JSONL record structures", () => {
    expect(sessionManifestSchema.parse(manifest)).toEqual(manifest);
    expect(
      persistedMessageRecordSchema.parse({
        messageId: "message-1",
        sessionId: manifest.sessionId,
        createdAt: manifest.createdAt,
        role: "user",
        content: "Remember this.",
      }),
    ).toMatchObject({ role: "user", content: "Remember this." });
    expect(
      persistedEventRecordSchema.parse({
        sequence: 1,
        recordedAt: manifest.createdAt,
        event: { type: "session.status-changed", data: { status: "preparing" } },
      }),
    ).toMatchObject({ sequence: 1, event: { type: "session.status-changed" } });
  });

  it("generates portable versioned path segments from the UTF-8 session ID", () => {
    expect(getSessionPersistencePaths("session-1")).toEqual({
      directory: ["sessions", "v1", "73657373696f6e2d31"],
      manifest: ["sessions", "v1", "73657373696f6e2d31", "manifest.json"],
      messages: ["sessions", "v1", "73657373696f6e2d31", "messages.jsonl"],
      events: ["sessions", "v1", "73657373696f6e2d31", "events.jsonl"],
    });
    expect(getSessionPersistencePaths("会话-1").directory.at(-1)).toBe("e4bc9ae8af9d2d31");
    expect(getSessionPersistencePaths("🦓").directory.at(-1)).toBe("f09fa693");
  });

  it("generates a portable versioned Checkpoint path", () => {
    expect(getCheckpointPersistencePaths("checkpoint-1")).toEqual({
      directory: ["checkpoints", "v1"],
      checkpoint: ["checkpoints", "v1", "636865636b706f696e742d31.json"],
    });
    expect(getCheckpointPersistencePaths("检查点-1").checkpoint.at(-1)).toBe(
      "e6a380e69fa5e782b92d31.json",
    );
  });

  it.each([
    { ...manifest, formatVersion: 2 },
    { ...manifest, sessionId: "x".repeat(maxPersistedSessionIdBytes + 1) },
    { ...manifest, sessionId: "会".repeat(34) },
    { ...manifest, sessionId: "\ud800" },
    { ...manifest, status: "running" },
    { ...manifest, createdAt: "2026-07-19T10:00:00" },
    { ...manifest, lastEventSequence: -1 },
    { ...manifest, unexpected: true },
  ])("rejects an invalid manifest %#", (candidate) => {
    expect(sessionManifestSchema.safeParse(candidate).success).toBe(false);
  });

  it.each([
    { sequence: 0, recordedAt: manifest.createdAt, event: { type: "session.created", data: {} } },
    { sequence: 1.5, recordedAt: manifest.createdAt, event: { type: "session.created", data: {} } },
    { sequence: 1, recordedAt: "not-a-date", event: { type: "session.created", data: {} } },
    { sequence: 1, recordedAt: manifest.createdAt, event: { type: "SessionCreated", data: {} } },
    {
      sequence: 1,
      recordedAt: manifest.createdAt,
      event: { type: "session.created", data: undefined },
    },
    {
      sequence: 1,
      recordedAt: manifest.createdAt,
      event: { type: "session.created", data: {}, unexpected: true },
    },
    {
      sequence: 1,
      recordedAt: manifest.createdAt,
      event: { type: "session.created", data: {} },
      unexpected: true,
    },
  ])("rejects an invalid event record %#", (candidate) => {
    expect(persistedEventRecordSchema.safeParse(candidate).success).toBe(false);
  });

  it("rejects a path session ID that cannot be represented portably", () => {
    expect(() => getSessionPersistencePaths("\udfff")).toThrow();
    expect(() => getSessionPersistencePaths("x".repeat(maxPersistedSessionIdBytes + 1))).toThrow();
  });

  it("rejects a Checkpoint path ID that cannot be represented portably", () => {
    expect(() => getCheckpointPersistencePaths("\udfff")).toThrow();
    expect(() =>
      getCheckpointPersistencePaths("x".repeat(maxPersistedCheckpointIdBytes + 1)),
    ).toThrow();
  });
});
