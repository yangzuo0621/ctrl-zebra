import { describe, expect, it } from "vitest";

import { utf8BytesForCodePoint } from "./text-primitives.js";

describe("Webview text primitives", () => {
  it("counts UTF-8 widths at scalar boundaries", () => {
    expect(utf8BytesForCodePoint(0x7f)).toBe(1);
    expect(utf8BytesForCodePoint(0x80)).toBe(2);
    expect(utf8BytesForCodePoint(0x800)).toBe(3);
    expect(utf8BytesForCodePoint(0x10000)).toBe(4);
  });
});
