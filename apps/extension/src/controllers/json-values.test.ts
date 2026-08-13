import { describe, expect, it } from "vitest";

import { jsonValuesEqual } from "./json-values.js";

describe("Extension JSON value equality", () => {
  it("compares nested JSON objects independent of key order", () => {
    expect(jsonValuesEqual({ a: 1, nested: { b: 2 } }, { nested: { b: 2 }, a: 1 })).toBe(true);
    expect(jsonValuesEqual({ values: [1, 2] }, { values: [2, 1] })).toBe(false);
  });
});
