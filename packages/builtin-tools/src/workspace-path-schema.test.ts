import { describe, expect, it } from "vitest";

import { isSafeForwardSlashPath } from "./boundary-validation.js";
import {
  maxWorkspaceRelativePathCharacters,
  workspaceRelativePathPattern,
  workspaceRelativePathSchema,
} from "./workspace-path-schema.js";

/**
 * `workspaceRelativePathPattern` exists only so a `pattern` hint can appear in the JSON Schema
 * advertised to the model; `isSafeForwardSlashPath` (options: allowLeadingSlash: false,
 * rejectCurrentSegments: true) remains the predicate every non-migrated tool still calls
 * directly. This proves the two agree on every input below, rather than assuming a hand-derived
 * regex matches a hand-written predicate.
 */
const inputs = [
  "src/new.txt",
  "README.md",
  "a/b/c.ts",
  "",
  "/outside.txt",
  "../outside.txt",
  "src/../outside.txt",
  "src/./new.txt",
  "src\\new.txt",
  "src/new.txt\\",
  "src//new.txt",
  "..",
  ".",
  "src/..",
  "src/.",
  "..hidden",
  "src/..hidden.ts",
  "src/file...ts",
  "😀/文件.ts",
  "a".repeat(maxWorkspaceRelativePathCharacters),
];

describe("workspaceRelativePathPattern", () => {
  it.each(inputs)("agrees with isSafeForwardSlashPath for %j", (value) => {
    expect(workspaceRelativePathPattern.test(value)).toBe(
      isSafeForwardSlashPath(value, {
        maxLength: maxWorkspaceRelativePathCharacters,
        allowLeadingSlash: false,
        rejectCurrentSegments: true,
      }),
    );
  });
});

describe("workspaceRelativePathSchema", () => {
  it("accepts a safe workspace-relative path", () => {
    expect(workspaceRelativePathSchema("A path.").safeParse("src/new.txt").success).toBe(true);
  });

  it.each(["", "/outside.txt", "../outside.txt", "src\\new.txt"])("rejects %j", (value) => {
    expect(workspaceRelativePathSchema("A path.").safeParse(value).success).toBe(false);
  });

  it("rejects a path over the character limit and accepts one at the limit", () => {
    const schema = workspaceRelativePathSchema("A path.", 10);
    expect(schema.safeParse("a".repeat(10)).success).toBe(true);
    expect(schema.safeParse("a".repeat(11)).success).toBe(false);
  });
});
