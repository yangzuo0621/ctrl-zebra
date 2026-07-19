import { describe, expect, it } from "vitest";

import {
  type Checkpoint,
  checkpointSchema,
  InvalidCheckpointIntegrityError,
  maxCheckpointFiles,
  parseCheckpoint,
} from "./index.js";

const beforeHash = "a".repeat(64);
const afterHash = "b".repeat(64);

const checkpoint = {
  id: "checkpoint-1",
  sessionId: "session-1",
  runId: "run-1",
  createdAt: "2026-07-19T16:00:00+08:00",
  files: [
    {
      uri: "file:///workspace/first.ts",
      beforeContent: "export const first = 1;\n",
      beforeHash,
      afterHash,
    },
    {
      uri: "file:///workspace/second.ts",
      beforeContent: "export const second = 2;\n",
      beforeHash,
      afterHash,
    },
  ],
} satisfies Checkpoint;

describe("checkpoint schema", () => {
  it("round-trips a multi-file Checkpoint through JSON", () => {
    const serialized = JSON.stringify(checkpoint);

    expect(checkpointSchema.parse(JSON.parse(serialized))).toEqual(checkpoint);
  });

  it.each([
    { ...checkpoint, id: "" },
    { ...checkpoint, sessionId: "" },
    { ...checkpoint, runId: "" },
    { ...checkpoint, createdAt: "2026-07-19T16:00:00" },
    { ...checkpoint, files: [] },
    {
      ...checkpoint,
      files: Array.from({ length: maxCheckpointFiles + 1 }, (_, index) => ({
        ...checkpoint.files[0],
        uri: `file:///workspace/${index}.ts`,
      })),
    },
    { ...checkpoint, files: [checkpoint.files[0], checkpoint.files[0]] },
    {
      ...checkpoint,
      files: [{ ...checkpoint.files[0], beforeHash: "A".repeat(64) }],
    },
    {
      ...checkpoint,
      files: [{ ...checkpoint.files[0], afterHash: "short" }],
    },
    {
      ...checkpoint,
      files: [{ ...checkpoint.files[0], unexpected: true }],
    },
    { ...checkpoint, unexpected: true },
  ])("rejects an invalid Checkpoint %#", (candidate) => {
    expect(checkpointSchema.safeParse(candidate).success).toBe(false);
  });

  it("validates the recorded before-content hash", () => {
    const hashText = (text: string) =>
      text === checkpoint.files[0].beforeContent || text === checkpoint.files[1].beforeContent
        ? beforeHash
        : "c".repeat(64);

    expect(parseCheckpoint(checkpoint, hashText)).toEqual(checkpoint);
    expect(() => parseCheckpoint(checkpoint, () => "c".repeat(64))).toThrow(
      InvalidCheckpointIntegrityError,
    );
  });
});
