import { describe, expect, it } from "vitest";

import { hasExactKeys, isPlainRecord, isRecord } from "./record-validation.js";

describe("Extension record validation", () => {
  it("keeps loose and strict record checks distinct", () => {
    const value = Object.create(null) as Record<string, unknown>;
    value.kind = "event";

    expect(isRecord(value)).toBe(true);
    expect(isPlainRecord(value)).toBe(true);
    expect(isRecord([value])).toBe(false);
  });

  it("rejects missing and extra keys", () => {
    expect(hasExactKeys({ kind: "event" }, ["kind"])).toBe(true);
    expect(hasExactKeys({ kind: "event", extra: true }, ["kind"])).toBe(false);
    expect(hasExactKeys({}, ["kind"])).toBe(false);
  });
});
