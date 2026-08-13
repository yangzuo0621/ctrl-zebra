import type { JsonValue } from "@ctrl-zebra/protocol";
import { describe, expect, it } from "vitest";

import { canonicalizeJson } from "./canonical-json.js";

describe("Core canonical JSON", () => {
  it("sorts object keys recursively while preserving array order", () => {
    const value: JsonValue = {
      z: 1,
      nested: { b: "text", a: true },
      array: [{ d: 4, c: null }],
    };

    expect(canonicalizeJson(value)).toBe(
      '{"array":[{"c":null,"d":4}],"nested":{"a":true,"b":"text"},"z":1}',
    );
  });
});
