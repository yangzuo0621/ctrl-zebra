import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  boundedWorkspaceTextSchema,
  countLogicalLines,
  isBoundedWorkspaceText,
} from "./bounded-text-schema.js";

const bounds = { maxCharacters: 10, maxLines: 2, maxBytes: 40 };

describe("countLogicalLines", () => {
  it.each([
    ["", 0],
    ["one line", 1],
    ["line one\nline two", 2],
    ["line one\r\nline two\r\n", 3],
    ["trailing newline\n", 2],
  ])("counts %j as %d logical lines", (text, expected) => {
    expect(countLogicalLines(text)).toBe(expected);
  });
});

describe("isBoundedWorkspaceText", () => {
  it("accepts text within every bound", () => {
    expect(isBoundedWorkspaceText("zebra\n", bounds)).toBe(true);
  });

  it("rejects a NUL byte", () => {
    expect(isBoundedWorkspaceText("ze\0bra", bounds)).toBe(false);
  });

  it("rejects an ill-formed string (a lone surrogate)", () => {
    expect(isBoundedWorkspaceText("\uD800", bounds)).toBe(false);
  });

  it("rejects text over the line bound", () => {
    expect(isBoundedWorkspaceText("a\nb\nc", bounds)).toBe(false);
  });

  it("rejects text over the byte bound", () => {
    expect(isBoundedWorkspaceText("😀", { ...bounds, maxBytes: 3 })).toBe(false);
  });

  it("counts the character bound by Unicode code point, not UTF-16 code unit", () => {
    // Each "😀" is one code point but two UTF-16 code units; ten of them must stay within a
    // ten-character bound (and comfortably within the wider byte bound used here).
    const tenEmoji = "😀".repeat(10);
    expect(isBoundedWorkspaceText(tenEmoji, { ...bounds, maxBytes: 1_000 })).toBe(true);
    expect(isBoundedWorkspaceText(`${tenEmoji}😀`, { ...bounds, maxBytes: 1_000 })).toBe(false);
  });
});

describe("boundedWorkspaceTextSchema", () => {
  it("advertises only a description, no maxLength, in the generated JSON Schema", () => {
    const schema = z.strictObject({ content: boundedWorkspaceTextSchema("Text.", bounds) });

    expect(z.toJSONSchema(schema).properties?.content).toEqual({
      type: "string",
      description: "Text.",
    });
  });

  it("enforces the same bound isBoundedWorkspaceText enforces", () => {
    const schema = boundedWorkspaceTextSchema("Text.", bounds);

    expect(schema.safeParse("zebra\n").success).toBe(true);
    expect(schema.safeParse("a\nb\nc").success).toBe(false);
  });
});
