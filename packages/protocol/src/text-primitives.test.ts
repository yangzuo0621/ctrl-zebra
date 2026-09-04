import { describe, expect, it } from "vitest";

import { utf8ByteLength, utf8BytesForCodePoint } from "./text-primitives.js";

describe("Protocol text primitives", () => {
  it("counts empty, ASCII, and mixed Unicode strings", () => {
    expect(utf8ByteLength("")).toBe(0);
    expect(utf8ByteLength("hello")).toBe(5);
    expect(utf8ByteLength("A¢€😀")).toBe(10);
  });

  it("uses the UTF-8 width at every scalar boundary", () => {
    expect(utf8BytesForCodePoint(0x7f)).toBe(1);
    expect(utf8BytesForCodePoint(0x80)).toBe(2);
    expect(utf8BytesForCodePoint(0x7ff)).toBe(2);
    expect(utf8BytesForCodePoint(0x800)).toBe(3);
    expect(utf8BytesForCodePoint(0xffff)).toBe(3);
    expect(utf8BytesForCodePoint(0x10000)).toBe(4);
    expect(utf8BytesForCodePoint(0x10ffff)).toBe(4);
  });

  it("counts a lone surrogate as its three-byte UTF-8 replacement width", () => {
    expect(utf8ByteLength("\ud800")).toBe(3);
    expect(utf8ByteLength("\udfff")).toBe(3);
    expect(utf8BytesForCodePoint(0xd800)).toBe(3);
  });
});
