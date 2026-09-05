import { describe, expect, it } from "vitest";

import {
  isSafeWorkspacePath,
  maxWorkspacePathBytes,
  maxWorkspacePathCharacters,
} from "./workspace-path.js";

const bounds = { maxCharacters: maxWorkspacePathCharacters, maxBytes: maxWorkspacePathBytes };

describe("isSafeWorkspacePath", () => {
  it.each([
    "src/new.txt",
    "a/b/c.ts",
    "README.md",
    "src/file.name.with.dots.ts",
    "src/file with spaces.ts",
  ])("accepts %s", (path) => {
    expect(isSafeWorkspacePath(path, bounds)).toBe(true);
  });

  it.each([
    ["empty string", ""],
    ["absolute path", "/outside.txt"],
    ["parent segment", "src/../outside.txt"],
    ["current segment", "src/./new.txt"],
    ["backslash", "src\\new.txt"],
    ["empty segment", "src//new.txt"],
    ["Windows drive letter", "C:/Users/victim/.ssh/id_rsa"],
    ["lowercase Windows drive letter", "c:/Windows/System32/x"],
    ["colon in a non-drive-letter position", "src/file.txt:evil"],
    ["reserved device name, bare", "CON"],
    ["reserved device name, with extension", "src/CON.txt"],
    ["reserved device name, case-insensitive", "src/con.txt"],
    ["reserved device name, mid-path", "src/AUX/file.ts"],
    ["reserved device name, COM port", "COM1"],
    ["trailing dot", "src/file.txt."],
    ["trailing space", "src/file.txt "],
  ])("rejects %s", (_name, path) => {
    expect(isSafeWorkspacePath(path, bounds)).toBe(false);
  });

  it("rejects a path over the character limit", () => {
    expect(isSafeWorkspacePath("x".repeat(maxWorkspacePathCharacters + 1), bounds)).toBe(false);
  });

  it("accepts a path at exactly the character limit", () => {
    expect(isSafeWorkspacePath("x".repeat(maxWorkspacePathCharacters), bounds)).toBe(true);
  });

  it("rejects a path over the byte limit", () => {
    expect(
      isSafeWorkspacePath("😀".repeat(Math.floor(maxWorkspacePathBytes / 4) + 1), bounds),
    ).toBe(false);
  });

  it("accepts a path at exactly the byte limit", () => {
    expect(isSafeWorkspacePath("😀".repeat(maxWorkspacePathBytes / 4), bounds)).toBe(true);
  });

  it("does not reject a filename that merely starts with a reserved device name", () => {
    // "console.ts" must not be confused with the reserved name "con" -- only an exact,
    // dot-separated leading segment counts.
    expect(isSafeWorkspacePath("src/console.ts", bounds)).toBe(true);
  });
});
