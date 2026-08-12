import { describe, expect, it } from "vitest";

import {
  IdeSourceProjectionError,
  ideSourceProjector,
} from "./ide-source-projector.js";

const root = (overrides: Partial<Parameters<typeof ideSourceProjector.sameUri>[0]> = {}) => ({
  scheme: "file",
  authority: "",
  path: "/workspace",
  query: "",
  fragment: "",
  ...overrides,
});

describe("IDE source projector", () => {
  it("projects a canonical relative path only for the same URI identity", () => {
    expect(
      ideSourceProjector.toWorkspaceRelativePath(root(), root({ path: "/workspace/src/😀.ts" })),
    ).toBe("src/😀.ts");
    expect(
      ideSourceProjector.toWorkspaceRelativePath(
        root({ scheme: "FILE", authority: "AUTH" }),
        root({ scheme: "file", authority: "auth", path: "/workspace/src/a.ts" }),
      ),
    ).toBe("src/a.ts");
  });

  it.each([
    ["different scheme", root(), root({ scheme: "untitled", path: "/workspace/a.ts" })],
    ["different authority", root(), root({ authority: "remote", path: "/workspace/a.ts" })],
    ["outside root", root(), root({ path: "/other/a.ts" })],
    ["root itself", root(), root()],
    ["dot segment", root(), root({ path: "/workspace/./a.ts" })],
    ["backslash", root(), root({ path: "/workspace\\a.ts" })],
  ] as const)("rejects %s", (_name, workspaceRoot, target) => {
    expect(() => ideSourceProjector.toWorkspaceRelativePath(workspaceRoot, target)).toThrow(
      IdeSourceProjectionError,
    );
  });

  it("preserves URI identity semantics for stale checks", () => {
    expect(ideSourceProjector.sameUri(root(), root({ scheme: "FILE" }))).toBe(true);
    expect(ideSourceProjector.sameUri(root(), root({ query: "v=1" }))).toBe(false);
    expect(ideSourceProjector.sameUri(root(), root({ path: "/workspace/other" }))).toBe(false);
  });

  it("counts Unicode scalars and UTF-8 bytes without splitting an astral scalar", () => {
    expect(ideSourceProjector.countCodePoints("A😀é")).toBe(3);
    expect(ideSourceProjector.utf8ByteLength("A😀é")).toBe(7);
    expect(ideSourceProjector.takeBoundedText("A😀é", 2, 5)).toEqual({
      text: "A😀",
      truncated: true,
      reasons: ["code-points", "utf8-bytes"],
    });
    expect(() => ideSourceProjector.takeBoundedText("\ud800", 1, 4)).toThrow(
      IdeSourceProjectionError,
    );
  });

  it.each([
    ["ASCII", "abc", 3, 3],
    ["astral", "😀", 1, 4],
    ["three-byte scalar", "€", 1, 3],
  ] as const)("reports the UTF-8 width of %s", (_name, value, codePoints, bytes) => {
    expect(ideSourceProjector.countCodePoints(value)).toBe(codePoints);
    expect(ideSourceProjector.utf8ByteLength(value)).toBe(bytes);
  });

  it("validates required bounded text and well-formed Unicode", () => {
    expect(ideSourceProjector.boundedRequired("name", 4, 4)).toBe("name");
    expect(() => ideSourceProjector.boundedRequired("name", 3, 4)).toThrow(
      IdeSourceProjectionError,
    );
    expect(ideSourceProjector.isBoundedWellFormedUnicode("😀", 1, 4)).toBe(true);
    expect(ideSourceProjector.isBoundedWellFormedUnicode("😀", 1, 3)).toBe(false);
    expect(ideSourceProjector.isBoundedWellFormedUnicode("\udc00", 1, 3)).toBe(false);
  });

  it("validates UTF-16 positions against document lines and surrogate boundaries", () => {
    expect(ideSourceProjector.isPosition({ line: 0, character: 2 })).toBe(true);
    expect(ideSourceProjector.isPosition({ line: 2_000, character: 0 })).toBe(false);
    expect(ideSourceProjector.isPosition({ line: 0, character: 131_073 })).toBe(false);
    expect(() =>
      ideSourceProjector.validateDocumentPosition(1, "a😀b", { line: 0, character: 2 }),
    ).toThrow(IdeSourceProjectionError);
    expect(() =>
      ideSourceProjector.validateDocumentPosition(1, "a😀b", { line: 0, character: 3 }),
    ).not.toThrow();
    expect(() =>
      ideSourceProjector.validateDocumentPosition(1, "a😀b", { line: 1, character: 0 }),
    ).toThrow(IdeSourceProjectionError);
  });

  it("provides deterministic scalar and range ordering", () => {
    expect(ideSourceProjector.compareStrings("😀", "é")).toBeGreaterThan(0);
    expect(ideSourceProjector.compareStrings("a", "aa")).toBeLessThan(0);
    expect(
      ideSourceProjector.compareOptionalRanges(
        { start: { line: 1, character: 0 }, end: { line: 1, character: 1 } },
        { start: { line: 1, character: 0 }, end: { line: 1, character: 2 } },
      ),
    ).toBeLessThan(0);
    expect(ideSourceProjector.compareOptionalStrings(undefined, "a")).toBeLessThan(0);
  });
});
