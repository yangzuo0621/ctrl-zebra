import { describe, expect, it } from "vitest";

import { isSafeForwardSlashPath } from "./boundary-validation.js";
import {
  maxWorkspaceGlobCharacters,
  workspaceGlobPattern,
  workspaceGlobSchema,
} from "./workspace-glob-schema.js";

/**
 * Proves workspaceGlobPattern agrees with isSafeForwardSlashPath (options: allowLeadingSlash:
 * true, rejectCurrentSegments: false) -- the predicate every non-migrated caller of a glob field
 * used to call directly -- on every input below, the same discipline workspace-path-schema.ts's
 * equivalent battery uses.
 */
const inputs = [
  "src/**/*.ts",
  "**/*",
  "/absolute/**",
  "src/../outside/**",
  "src/./sub/**",
  "src\\sub\\**",
  "",
  "..",
  "src/..",
  "a".repeat(maxWorkspaceGlobCharacters),
  "src/a\nfile/**",
  "src/a\rfile/**",
];

describe("workspaceGlobPattern", () => {
  it.each(inputs)("agrees with isSafeForwardSlashPath for %j", (value) => {
    expect(workspaceGlobPattern.test(value)).toBe(
      isSafeForwardSlashPath(value, {
        maxLength: maxWorkspaceGlobCharacters,
        allowLeadingSlash: true,
        rejectCurrentSegments: false,
      }),
    );
  });
});

describe("workspaceGlobSchema", () => {
  it("accepts a leading slash and a single-dot segment, unlike workspaceRelativePathSchema", () => {
    const schema = workspaceGlobSchema("A glob.");
    expect(schema.safeParse("/abs/**").success).toBe(true);
    expect(schema.safeParse("src/./sub/**").success).toBe(true);
  });

  it.each(["", "../outside/**", "src\\sub"])("rejects %j", (value) => {
    expect(workspaceGlobSchema("A glob.").safeParse(value).success).toBe(false);
  });

  it("rejects a glob over the character limit and accepts one at the limit", () => {
    const schema = workspaceGlobSchema("A glob.", 10);
    expect(schema.safeParse("a".repeat(10)).success).toBe(true);
    expect(schema.safeParse("a".repeat(11)).success).toBe(false);
  });
});
