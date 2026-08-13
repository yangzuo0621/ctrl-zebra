import { describe, expect, it } from "vitest";

import { hasOnlyKeys, isPlainRecord, isRecord } from "./record-validation.js";

describe("MCP record validation", () => {
  it("shares loose JSON-object and strict plain-record semantics", () => {
    class Message {
      readonly value = 1;
    }

    expect(isRecord(new Message())).toBe(true);
    expect(isPlainRecord(new Message())).toBe(false);
    expect(isPlainRecord({ value: 1 })).toBe(true);
    expect(isPlainRecord([])).toBe(false);
  });

  it("checks allowed keys without requiring every allowed key", () => {
    expect(hasOnlyKeys({ value: 1 }, new Set(["value", "optional"]))).toBe(true);
    expect(hasOnlyKeys({ unexpected: true }, new Set(["value", "optional"]))).toBe(false);
  });
});
