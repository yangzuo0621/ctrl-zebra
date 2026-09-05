import { describe, expect, it } from "vitest";

import { CircularJsonValueError, canonicalizeJson } from "./canonical-json.js";
import type { JsonValue } from "./tool.js";

describe("canonicalizeJson", () => {
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

  it("sorts nested object keys while preserving array order", () => {
    expect(canonicalizeJson({ z: 1, nested: { b: true, a: null }, values: [2, 1] })).toBe(
      '{"nested":{"a":null,"b":true},"values":[2,1],"z":1}',
    );
  });

  it.each([
    ["", ""],
    ["null", null],
    ["1", 1],
    ["true", true],
    ["[]", []],
    ["{}", {}],
  ] as const)("canonicalizes a bare primitive %s the same as JSON.stringify", (_name, value) => {
    expect(canonicalizeJson(value)).toBe(JSON.stringify(value));
  });

  it("drops an object key whose value is undefined, matching JSON.stringify", () => {
    const value = { a: 1, b: undefined } as unknown as JsonValue;
    expect(canonicalizeJson(value)).toBe(JSON.stringify(value));
    expect(canonicalizeJson(value)).toBe('{"a":1}');
  });

  it("encodes an undefined array element as null, matching JSON.stringify", () => {
    const value = [1, undefined, 3] as unknown as JsonValue;
    expect(canonicalizeJson(value)).toBe(JSON.stringify(value));
    expect(canonicalizeJson(value)).toBe("[1,null,3]");
  });

  it("throws CircularJsonValueError for a self-referencing object instead of overflowing the stack", () => {
    const value: Record<string, unknown> = { a: 1 };
    value.self = value;

    expect(() => canonicalizeJson(value as unknown as JsonValue)).toThrow(CircularJsonValueError);
  });

  it("throws CircularJsonValueError for a self-referencing array instead of overflowing the stack", () => {
    const value: unknown[] = [1];
    value.push(value);

    expect(() => canonicalizeJson(value as unknown as JsonValue)).toThrow(CircularJsonValueError);
  });

  it("does not confuse a repeated (but non-circular) nested value with a cycle", () => {
    const shared = { x: 1 };
    // The same object instance appears twice in the input, at sibling positions, not as its own
    // ancestor -- this must canonicalize normally, not throw.
    const value = { left: shared, right: shared };

    expect(canonicalizeJson(value)).toBe('{"left":{"x":1},"right":{"x":1}}');
  });
});
