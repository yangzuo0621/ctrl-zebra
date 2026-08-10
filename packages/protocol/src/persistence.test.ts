import { describe, expect, it } from "vitest";

import {
  getCheckpointPersistencePaths,
  getSessionPersistencePaths,
  maxPersistedCheckpointIdBytes,
  maxPersistedSessionIdBytes,
  persistedEventPayloadSchema,
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

  it("strictly validates confirmed MCP Prompt projections", () => {
    expect(
      persistedEventPayloadSchema.safeParse({
        type: "session.mcp-prompt-confirmed",
        data: {
          serverId: "local_fixture",
          promptName: "review",
          projectedText: "ordinary prompt context",
        },
      }).success,
    ).toBe(true);
    expect(
      persistedEventPayloadSchema.safeParse({
        type: "session.mcp-prompt-confirmed",
        data: {
          serverId: "local_fixture",
          promptName: "review",
          projectedText: "x",
          role: "system",
        },
      }).success,
    ).toBe(false);
  });

  it("strictly validates bounded immutable MCP Resource attachments", () => {
    expect(
      persistedEventPayloadSchema.parse({
        type: "session.mcp-resource-attached",
        data: {
          snapshotId: "snapshot-1",
          serverId: "local_fixture",
          uri: "memory://note",
          mimeType: "text/plain",
          text: "ordinary external context",
          truncated: false,
        },
      }),
    ).toBeDefined();
    expect(
      persistedEventPayloadSchema.safeParse({
        type: "session.mcp-resource-attached",
        data: {
          snapshotId: "snapshot-1",
          serverId: "local_fixture",
          uri: "memory://note",
          mimeType: "text/plain",
          text: "x",
          truncated: false,
          generation: 3,
        },
      }).success,
    ).toBe(false);
  });

  it("strictly validates bounded Provider Usage events and permits partial fields", () => {
    expect(
      persistedEventPayloadSchema.parse({
        type: "session.usage",
        data: { inputTokens: 5, totalTokens: 5 },
      }),
    ).toEqual({ type: "session.usage", data: { inputTokens: 5, totalTokens: 5 } });
    expect(
      persistedEventPayloadSchema.safeParse({
        type: "session.usage",
        data: { outputTokens: -1 },
      }).success,
    ).toBe(false);
    expect(
      persistedEventPayloadSchema.safeParse({
        type: "session.usage",
        data: { totalTokens: 1, source: "estimate" },
      }).success,
    ).toBe(false);
  });

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

  it("strictly validates bounded MCP Tool Call and Result provenance", () => {
    const source = {
      serverId: "local_fixture",
      registryName: "mcp_calculate_123456789abc",
      mcpToolName: "calculate",
      generation: 2,
    } as const;
    const call = {
      sequence: 1,
      recordedAt: manifest.createdAt,
      event: {
        type: "session.mcp-tool-call",
        data: {
          call: { id: "call-1", name: source.registryName, input: { count: 2 } },
          source,
        },
      },
    };
    const result = {
      sequence: 2,
      recordedAt: manifest.createdAt,
      event: {
        type: "session.mcp-tool-result",
        data: {
          result: {
            callId: "call-1",
            name: source.registryName,
            status: "success",
            output: { content: [{ type: "text", text: "done" }] },
            truncated: false,
          },
          source,
        },
      },
    };

    expect(persistedEventRecordSchema.parse(call)).toEqual(call);
    expect(persistedEventRecordSchema.parse(result)).toEqual(result);
    expect(
      persistedEventRecordSchema.safeParse({
        ...call,
        event: { ...call.event, data: { ...call.event.data, source: { ...source, extra: true } } },
      }).success,
    ).toBe(false);
    expect(
      persistedEventRecordSchema.safeParse({
        ...call,
        event: {
          ...call.event,
          data: {
            ...call.event.data,
            source: { ...source, registryName: "mcp_other_123456789abc" },
          },
        },
      }).success,
    ).toBe(false);
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
