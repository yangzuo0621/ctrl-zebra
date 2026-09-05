import { describe, expect, it } from "vitest";

import {
  InvalidFileDeletePlanError,
  InvalidFileRenamePlanError,
  parseFileDeletePlan,
  parseFileRenamePlan,
} from "./file-delete-rename.js";

const beforeContent = "zebra\n";
const beforeHash = "a".repeat(64);
const hashText = (text: string) => (text === beforeContent ? beforeHash : "b".repeat(64));

const deletePlan = {
  operation: "delete",
  path: "src/old.txt",
  uri: "file:///workspace/src/old.txt",
  beforeContent,
  beforeHash,
} as const;

const renamePlan = {
  operation: "rename",
  sourcePath: "src/old.txt",
  targetPath: "src/new.txt",
  sourceUri: "file:///workspace/src/old.txt",
  targetUri: "file:///workspace/src/new.txt",
  beforeContent,
  beforeHash,
} as const;

describe("file lifecycle plans", () => {
  it("parses a complete delete plan and verifies its content identity", () => {
    expect(parseFileDeletePlan(deletePlan, hashText)).toEqual(deletePlan);
  });

  it("parses a complete rename plan and verifies its content identity", () => {
    expect(parseFileRenamePlan(renamePlan, hashText)).toEqual(renamePlan);
  });

  it.each([
    { path: "../outside.txt" },
    { path: "/outside.txt" },
    { path: "src\\old.txt" },
    { path: "src/./old.txt" },
    { path: "C:/Users/victim/.ssh/id_rsa" },
    { beforeHash: "short" },
    { beforeContent: "\0binary" },
  ])("rejects an invalid delete plan %#", (patch) => {
    expect(() => parseFileDeletePlan({ ...deletePlan, ...patch }, hashText)).toThrow(
      InvalidFileDeletePlanError,
    );
  });

  it.each([
    { sourcePath: "../outside.txt" },
    { targetPath: "src/./new.txt" },
    { targetPath: "C:/Users/victim/.ssh/id_rsa" },
    { sourcePath: renamePlan.targetPath, targetPath: renamePlan.targetPath },
    { sourceUri: renamePlan.targetUri, targetUri: renamePlan.targetUri },
    { beforeHash: "short" },
  ])("rejects an invalid rename plan %#", (patch) => {
    expect(() => parseFileRenamePlan({ ...renamePlan, ...patch }, hashText)).toThrow(
      InvalidFileRenamePlanError,
    );
  });

  it("rejects content when the supplied hash is stale or hashing fails", () => {
    expect(() => parseFileDeletePlan(deletePlan, () => "c".repeat(64))).toThrow(
      InvalidFileDeletePlanError,
    );
    expect(() =>
      parseFileRenamePlan(renamePlan, () => {
        throw new Error("hash failure");
      }),
    ).toThrow(InvalidFileRenamePlanError);
  });

  it("rejects unknown plan properties", () => {
    expect(() => parseFileDeletePlan({ ...deletePlan, extra: true }, hashText)).toThrow(
      InvalidFileDeletePlanError,
    );
    expect(() => parseFileRenamePlan({ ...renamePlan, extra: true }, hashText)).toThrow(
      InvalidFileRenamePlanError,
    );
  });
});
