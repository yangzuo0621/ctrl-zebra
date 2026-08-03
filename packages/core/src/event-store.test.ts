import type { PersistedEventRecord } from "@ctrl-zebra/protocol";
import { describe, expect, it } from "vitest";

import {
  CorruptEventLogError,
  EventLogLimitExceededError,
  type EventStorage,
  InvalidEventSequenceError,
  InvalidPersistedEventError,
  JsonlEventStore,
  maxEventLogBytes,
  maxEventRecordBytes,
} from "./event-store.js";
import type { PersistencePath } from "./manifest-store.js";

const sessionId = "session-1";

function event(sequence: number): PersistedEventRecord {
  return {
    sequence,
    recordedAt: `2026-07-19T10:00:0${sequence}+08:00`,
    event: { type: "session.status-changed", data: { status: "streaming" } },
  };
}

describe("JsonlEventStore", () => {
  it("appends and reads events in contiguous sequence order", async () => {
    const storage = new FakeEventStorage();
    const store = new JsonlEventStore(storage);

    await store.append(sessionId, event(1));
    await store.append(sessionId, event(2));

    await expect(store.read(sessionId)).resolves.toEqual({
      records: [event(1), event(2)],
      tailDamaged: false,
    });
    expect(storage.appendLimits).toEqual([maxEventLogBytes, maxEventLogBytes]);
  });

  it("treats a missing file and blank lines as an empty or valid log", async () => {
    const storage = new FakeEventStorage();
    const store = new JsonlEventStore(storage);

    await expect(store.read(sessionId)).resolves.toEqual({ records: [], tailDamaged: false });
    storage.content = `\n  \n${JSON.stringify(event(1))}\n\n`;
    await expect(store.read(sessionId)).resolves.toEqual({
      records: [event(1)],
      tailDamaged: false,
    });
  });

  it.each([
    '{"sequence":2',
    JSON.stringify({ ...event(2), unexpected: true }),
  ])("retains valid records and reports a damaged final record %#", async (damagedTail) => {
    const storage = new FakeEventStorage();
    storage.content = `${JSON.stringify(event(1))}\n${damagedTail}`;
    const store = new JsonlEventStore(storage);

    await expect(store.read(sessionId)).resolves.toEqual({
      records: [event(1)],
      tailDamaged: true,
    });
  });

  it("rejects an invalid record before the final non-empty line", async () => {
    const storage = new FakeEventStorage();
    storage.content = `${JSON.stringify(event(1))}\nnot-json\n${JSON.stringify(event(2))}\n`;
    const store = new JsonlEventStore(storage);

    await expect(store.read(sessionId)).rejects.toMatchObject({
      name: "CorruptEventLogError",
      reason: "invalid-record",
      lineNumber: 2,
    });
  });

  it.each([
    [event(2), 1],
    [{ ...event(1), sequence: 1 }, 2],
  ] as const)("rejects a duplicate or skipped sequence %#", async (badRecord, lineNumber) => {
    const storage = new FakeEventStorage();
    storage.content =
      lineNumber === 1
        ? `${JSON.stringify(badRecord)}\n`
        : `${JSON.stringify(event(1))}\n${JSON.stringify(badRecord)}\n`;
    const store = new JsonlEventStore(storage);

    await expect(store.read(sessionId)).rejects.toEqual(
      expect.objectContaining({
        name: "CorruptEventLogError",
        reason: "invalid-sequence",
        lineNumber,
      }),
    );
  });

  it("rejects invalid and non-contiguous appends without writing", async () => {
    const storage = new FakeEventStorage();
    const store = new JsonlEventStore(storage);

    await expect(store.append(sessionId, { ...event(1), unexpected: true })).rejects.toBeInstanceOf(
      InvalidPersistedEventError,
    );
    await expect(store.append(sessionId, event(2))).rejects.toBeInstanceOf(
      InvalidEventSequenceError,
    );
    expect(storage.appended).toEqual([]);
  });

  it("refuses to append after a damaged tail", async () => {
    const storage = new FakeEventStorage();
    storage.content = `${JSON.stringify(event(1))}\n{`;
    const store = new JsonlEventStore(storage);

    await expect(store.append(sessionId, event(2))).rejects.toBeInstanceOf(CorruptEventLogError);
    expect(storage.appended).toEqual([]);
  });

  it("rejects an oversized event before appending it", async () => {
    const storage = new FakeEventStorage();
    const store = new JsonlEventStore(storage);

    await expect(
      store.append(sessionId, {
        ...event(1),
        event: { type: "session.recorded", data: "x".repeat(maxEventRecordBytes) },
      }),
    ).rejects.toBeInstanceOf(EventLogLimitExceededError);
    expect(storage.appended).toEqual([]);
  });

  it("accepts a complete MCP Tool pair and permits an interrupted call without a Result", async () => {
    const storage = new FakeEventStorage();
    storage.content = `${JSON.stringify(mcpCall(1))}\n${JSON.stringify(mcpResult(2))}\n`;
    const store = new JsonlEventStore(storage);

    await expect(store.read(sessionId)).resolves.toMatchObject({ tailDamaged: false });
    storage.content = `${JSON.stringify(mcpCall(1))}\n`;
    await expect(store.read(sessionId)).resolves.toMatchObject({ tailDamaged: false });
  });

  it.each([
    [mcpResult(1), "orphan Result"],
    [
      {
        ...mcpResult(2),
        event: {
          ...mcpResult(2).event,
          data: {
            ...mcpResult(2).event.data,
            source: { ...mcpSource, generation: 4 },
          },
        },
      },
      "mismatched generation",
    ],
  ])("rejects an MCP Tool pair with %s", async (badResult) => {
    const storage = new FakeEventStorage();
    storage.content =
      badResult.sequence === 1
        ? `${JSON.stringify(badResult)}\n`
        : `${JSON.stringify(mcpCall(1))}\n${JSON.stringify(badResult)}\n`;
    const store = new JsonlEventStore(storage);

    await expect(store.read(sessionId)).rejects.toMatchObject({
      name: "CorruptEventLogError",
      reason: "invalid-record",
    });
  });
});

const mcpSource = {
  serverId: "local_fixture",
  registryName: "mcp_run_123456789abc",
  mcpToolName: "run",
  generation: 3,
} as const;

function mcpCall(sequence: number): PersistedEventRecord {
  return {
    sequence,
    recordedAt: "2026-08-03T00:00:00.000Z",
    event: {
      type: "session.mcp-tool-call",
      data: {
        call: { id: "call-1", name: mcpSource.registryName, input: {} },
        source: mcpSource,
      },
    },
  };
}

function mcpResult(sequence: number): PersistedEventRecord {
  return {
    sequence,
    recordedAt: "2026-08-03T00:00:00.000Z",
    event: {
      type: "session.mcp-tool-result",
      data: {
        result: {
          callId: "call-1",
          name: mcpSource.registryName,
          status: "success",
          output: { content: [] },
          truncated: false,
        },
        source: mcpSource,
      },
    },
  };
}

class FakeEventStorage implements EventStorage {
  content: string | undefined;
  readonly appended: string[] = [];
  readonly appendLimits: number[] = [];

  async readText(_path: PersistencePath, maxBytes: number): Promise<string | undefined> {
    expect(maxBytes).toBe(maxEventLogBytes);
    return this.content;
  }

  async appendText(_path: PersistencePath, content: string, maxTotalBytes: number): Promise<void> {
    this.appended.push(content);
    this.appendLimits.push(maxTotalBytes);
    this.content = `${this.content ?? ""}${content}`;
  }
}
