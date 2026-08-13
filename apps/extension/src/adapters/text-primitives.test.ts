import { describe, expect, it } from "vitest";

import { utf8ByteLength, utf8BytesForCodePoint } from "./text-primitives.js";

describe("Extension text primitives", () => {
  it("counts valid UTF-8 scalar widths", () => {
    expect(utf8ByteLength("A¢€😀")).toBe(10);
    expect(utf8BytesForCodePoint(0x10ffff)).toBe(4);
  });

  it("preserves TextEncoder replacement behavior for lone surrogates", () => {
    expect(utf8ByteLength("\ud800")).toBe(3);
  });
});
