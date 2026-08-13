import { describe, expect, it } from "vitest";

import { canonicalJson } from "./canonical-json.js";

describe("Webview canonical JSON", () => {
  it("sorts nested object keys while preserving array order", () => {
    expect(canonicalJson({ z: 1, nested: { b: true, a: null }, values: [2, 1] })).toBe(
      '{"nested":{"a":null,"b":true},"values":[2,1],"z":1}',
    );
  });
});
