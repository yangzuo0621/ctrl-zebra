import { describe, expect, it } from "vitest";

import { utf8BytesForCodePoint } from "./text-primitives.js";

describe("Provider text primitives", () => {
  it("counts every UTF-8 code-point width boundary", () => {
    expect(utf8BytesForCodePoint(0x7f)).toBe(1);
    expect(utf8BytesForCodePoint(0x80)).toBe(2);
    expect(utf8BytesForCodePoint(0x800)).toBe(3);
    expect(utf8BytesForCodePoint(0x10000)).toBe(4);
    expect(utf8BytesForCodePoint(0x10ffff)).toBe(4);
  });
});
