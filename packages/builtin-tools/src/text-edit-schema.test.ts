import { describe, expect, it } from "vitest";
import { z } from "zod";

import { textPositionSchema, textRangeSchema } from "./text-edit-schema.js";

describe("textPositionSchema", () => {
  it("accepts a zero-based non-negative integer position", () => {
    expect(textPositionSchema.safeParse({ line: 0, character: 0 }).success).toBe(true);
  });

  it.each([
    { line: -1, character: 0 },
    { line: 0, character: -1 },
    { line: 1.5, character: 0 },
  ])("rejects a negative or non-integer field %#", (value) => {
    expect(textPositionSchema.safeParse(value).success).toBe(false);
  });

  it("advertises the exact shape shared by propose_file_edit and propose_workspace_edit", () => {
    expect(z.toJSONSchema(textPositionSchema)).toMatchObject({
      type: "object",
      description: "A zero-based text position.",
      properties: {
        line: { type: "integer", description: "Zero-based line number.", minimum: 0 },
        character: {
          type: "integer",
          description: "Zero-based UTF-16 character offset.",
          minimum: 0,
        },
      },
      required: ["line", "character"],
      additionalProperties: false,
    });
  });
});

describe("textRangeSchema", () => {
  it("accepts a start/end position pair", () => {
    expect(
      textRangeSchema.safeParse({
        start: { line: 0, character: 0 },
        end: { line: 0, character: 3 },
      }).success,
    ).toBe(true);
  });

  it("rejects an extra property", () => {
    expect(
      textRangeSchema.safeParse({
        start: { line: 0, character: 0 },
        end: { line: 0, character: 3 },
        extra: true,
      }).success,
    ).toBe(false);
  });
});
