import { describe, expect, it } from "vitest";

import {
  InvalidFileCreatePlanError,
  maxFileCreateContentBytes,
  maxFileCreateContentCharacters,
  maxFileCreateContentLines,
  maxFileCreatePathBytes,
  maxFileCreatePathCharacters,
  parseFileCreatePlan,
} from "./file-create.js";

const validContent = "zebra\n";
const validHash = "a".repeat(64);
const validPlan = {
  operation: "create",
  path: "src/new.txt",
  uri: "file:///workspace/src/new.txt",
  content: validContent,
  afterHash: validHash,
} as const;

const hashText = (content: string) => (content === validContent ? validHash : "b".repeat(64));

describe("File Create Plan", () => {
  it("parses a bounded UTF-8 plan and verifies its content hash", () => {
    expect(parseFileCreatePlan(validPlan, hashText)).toEqual(validPlan);
  });

  it("accepts the content and path limits at their exact boundaries", () => {
    const boundedContent = "😀".repeat(maxFileCreateContentCharacters);
    const boundedPlan = {
      ...validPlan,
      path: "😀".repeat(maxFileCreatePathBytes / 4),
      content: boundedContent,
      afterHash: validHash,
    };
    expect(() => parseFileCreatePlan(boundedPlan, () => validHash)).not.toThrow();

    expect(() =>
      parseFileCreatePlan(
        {
          ...validPlan,
          content: Array.from({ length: maxFileCreateContentLines }, () => "x").join("\n"),
        },
        () => validHash,
      ),
    ).not.toThrow();
  });

  it.each([
    { name: "absolute path", patch: { path: "/outside.txt" } },
    { name: "parent segment", patch: { path: "src/../outside.txt" } },
    { name: "current segment", patch: { path: "src/./new.txt" } },
    { name: "backslash", patch: { path: "src\\new.txt" } },
    { name: "Windows drive letter", patch: { path: "C:/Users/victim/.ssh/id_rsa" } },
    {
      name: "path scalar limit",
      patch: { path: "x".repeat(maxFileCreatePathCharacters + 1) },
    },
    {
      name: "path byte limit",
      patch: { path: "😀".repeat(Math.floor(maxFileCreatePathBytes / 4) + 1) },
    },
    { name: "NUL content", patch: { content: "before\0after" } },
    { name: "unpaired surrogate", patch: { content: "before\ud800after" } },
    {
      name: "content scalar limit",
      patch: { content: "x".repeat(maxFileCreateContentCharacters + 1) },
    },
    {
      name: "content byte limit",
      patch: { content: "😀".repeat(Math.floor(maxFileCreateContentBytes / 4) + 1) },
    },
    {
      name: "line limit",
      patch: {
        content: Array.from({ length: maxFileCreateContentLines + 1 }, () => "x").join("\n"),
      },
    },
    { name: "hash mismatch", patch: { afterHash: "c".repeat(64) } },
  ])("rejects $name", ({ patch }) => {
    expect(() => parseFileCreatePlan({ ...validPlan, ...patch }, hashText)).toThrow(
      InvalidFileCreatePlanError,
    );
  });

  it("rejects malformed plan fields and a hasher failure", () => {
    expect(() => parseFileCreatePlan({ ...validPlan, extra: true }, hashText)).toThrow(
      InvalidFileCreatePlanError,
    );
    expect(() =>
      parseFileCreatePlan(validPlan, () => {
        throw new Error("hash failed");
      }),
    ).toThrow(InvalidFileCreatePlanError);
  });
});
