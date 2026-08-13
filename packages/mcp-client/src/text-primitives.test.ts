import { describe, expect, it } from "vitest";

import { utf8ByteLength } from "./text-primitives.js";

describe("MCP text primitives", () => {
  it("counts serialized text across UTF-8 widths", () => {
    expect(utf8ByteLength("A¢€😀")).toBe(10);
  });

  it("preserves TextEncoder replacement behavior for lone surrogates", () => {
    expect(utf8ByteLength("\ud800")).toBe(3);
  });
});
