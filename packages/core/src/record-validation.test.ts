import { describe, expect, it } from "vitest";

import {
  hasExactKeys,
  hasOnlyKeys,
  isNonnegativeSafeInteger,
  isPlainRecord,
  isRecord,
} from "./record-validation.js";

describe("Core record validation", () => {
  it("accepts objects but rejects null and arrays", () => {
    expect(isRecord({ value: 1 })).toBe(true);
    expect(isRecord(Object.create(null))).toBe(true);
    expect(isRecord(null)).toBe(false);
    expect(isRecord([])).toBe(false);
  });

  it("distinguishes plain records from class instances", () => {
    class Message {
      readonly value = 1;
    }

    expect(isPlainRecord({ value: 1 })).toBe(true);
    expect(isPlainRecord(Object.create(null))).toBe(true);
    expect(isPlainRecord(new Message())).toBe(false);
  });

  it("requires an exact key set independent of insertion order", () => {
    expect(hasExactKeys({ b: 2, a: 1 }, ["a", "b"])).toBe(true);
    expect(hasExactKeys({ a: 1, b: 2, c: 3 }, ["a", "b"])).toBe(false);
    expect(hasExactKeys({ a: 1 }, ["a", "b"])).toBe(false);
  });

  it("accepts a subset of an allowed key set", () => {
    expect(hasOnlyKeys({ path: "src/index.ts" }, new Set(["path", "startLine"]))).toBe(true);
    expect(hasOnlyKeys({ command: "delete" }, new Set(["path", "startLine"]))).toBe(false);
  });

  it("accepts non-negative safe integers only", () => {
    expect(isNonnegativeSafeInteger(0)).toBe(true);
    expect(isNonnegativeSafeInteger(1)).toBe(true);
    expect(isNonnegativeSafeInteger(Number.MAX_SAFE_INTEGER)).toBe(true);
    expect(isNonnegativeSafeInteger(-1)).toBe(false);
    expect(isNonnegativeSafeInteger(1.5)).toBe(false);
    expect(isNonnegativeSafeInteger(Number.MAX_SAFE_INTEGER + 1)).toBe(false);
    expect(isNonnegativeSafeInteger("0")).toBe(false);
    expect(isNonnegativeSafeInteger(null)).toBe(false);
  });
});
