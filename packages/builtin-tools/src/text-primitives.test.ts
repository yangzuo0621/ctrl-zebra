import { describe, expect, it } from "vitest";

import { utf8ByteLength } from "./text-primitives.js";

describe("builtin-tool text primitives", () => {
  it("counts UTF-8 bytes across scalar widths", () => {
    expect(utf8ByteLength("A¢€😀")).toBe(10);
  });

  it("uses replacement width for lone surrogates like TextEncoder", () => {
    expect(utf8ByteLength("\ud800")).toBe(3);
  });
});
