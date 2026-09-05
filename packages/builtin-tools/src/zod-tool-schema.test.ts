import { describe, expect, it } from "vitest";
import { z } from "zod";

import { toToolInputSchema } from "./zod-tool-schema.js";

describe("toToolInputSchema", () => {
  it("strips the $schema version marker", () => {
    const schema = toToolInputSchema(z.strictObject({ name: z.string() }));

    expect(schema).not.toHaveProperty("$schema");
  });

  it("always includes required, even for an object schema with no required properties", () => {
    // z.toJSONSchema() omits the "required" key entirely in this case; ToolInputSchema.required
    // is mandatory, so every caller (e.g. providers' `[...schema.required]`) must be able to rely
    // on it always being an array.
    const schema = toToolInputSchema(z.strictObject({ name: z.string().optional() }));

    expect(schema.required).toEqual([]);
  });

  it("preserves the actual required properties when some are required", () => {
    const schema = toToolInputSchema(
      z.strictObject({ name: z.string(), nickname: z.string().optional() }),
    );

    expect(schema.required).toEqual(["name"]);
  });
});
