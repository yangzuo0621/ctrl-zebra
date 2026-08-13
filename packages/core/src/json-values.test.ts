import type { JsonValue } from "@ctrl-zebra/protocol";
import { describe, expect, it } from "vitest";

import { jsonValuesEqual } from "./json-values.js";

describe("Core JSON value equality", () => {
  it("ignores object key insertion order but preserves array order", () => {
    const first: JsonValue = { nested: { a: 1, b: ["x", "y"] } };
    const equivalent: JsonValue = { nested: { b: ["x", "y"], a: 1 } };
    const reordered: JsonValue = { nested: { b: ["y", "x"], a: 1 } };

    expect(jsonValuesEqual(first, equivalent)).toBe(true);
    expect(jsonValuesEqual(first, reordered)).toBe(false);
  });
});
