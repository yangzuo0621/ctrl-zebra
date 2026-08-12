import { describe, expect, it } from "vitest";

import {
  ideLanguageLocationsResultSchema,
  ideReadOnlyToolResultSchema,
  ideSymbolsResultSchema,
  maxIdeDiagnosticLabelCodePoints,
  maxIdeSymbolEntries,
} from "./index.js";

const source = {
  uri: { scheme: "file", authority: "", path: "src/index.ts" },
  stale: false,
  truncated: false,
} as const;

const range = {
  start: { line: 0, character: 0 },
  end: { line: 0, character: 3 },
} as const;

describe("IDE language DTOs", () => {
  it("accepts strict location and flat symbol results", () => {
    const locations = {
      kind: "language-locations",
      operation: "definition",
      source,
      locations: [{ source, range, kind: "definition" }],
      stale: false,
      truncated: false,
    };
    const symbols = {
      kind: "symbols",
      source,
      symbols: [
        {
          name: "answer",
          kind: "variable",
          range,
          selectionRange: range,
          detail: "number",
          containerName: "module",
        },
      ],
      stale: false,
      truncated: false,
    };

    expect(ideLanguageLocationsResultSchema.parse(locations)).toEqual(locations);
    expect(ideSymbolsResultSchema.parse(symbols)).toEqual(symbols);
    expect(ideReadOnlyToolResultSchema.parse(symbols)).toEqual(symbols);
  });

  it("requires truncation reasons and rejects unknown DTO fields", () => {
    expect(
      ideLanguageLocationsResultSchema.safeParse({
        kind: "language-locations",
        operation: "references",
        source,
        locations: [],
        stale: false,
        truncated: true,
      }).success,
    ).toBe(false);
    expect(
      ideSymbolsResultSchema.safeParse({
        kind: "symbols",
        source,
        symbols: [],
        stale: false,
        truncated: false,
        extra: true,
      }).success,
    ).toBe(false);
    expect(
      ideLanguageLocationsResultSchema.safeParse({
        kind: "language-locations",
        operation: "references",
        source,
        locations: [],
        stale: false,
        truncated: true,
        truncationReasons: ["entries", "entries"],
      }).success,
    ).toBe(false);
  });

  it("enforces the language aggregate ceiling independently of entry count", () => {
    const largeSource = {
      ...source,
      uri: { ...source.uri, path: "x".repeat(4_096) },
    };
    const locations = Array.from({ length: 32 }, () => ({
      source: largeSource,
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 0 },
      },
      kind: "reference" as const,
    }));

    expect(
      ideLanguageLocationsResultSchema.safeParse({
        kind: "language-locations",
        operation: "references",
        source: largeSource,
        locations,
        stale: false,
        truncated: true,
        truncationReasons: ["code-points"],
      }).success,
    ).toBe(false);
  });

  it("enforces symbol entry and field bounds", () => {
    const result = {
      kind: "symbols",
      source,
      symbols: Array.from({ length: maxIdeSymbolEntries + 1 }, () => ({
        name: "x",
        kind: "unknown",
        range,
      })),
      stale: false,
      truncated: true,
      truncationReasons: ["entries"],
    };
    expect(ideSymbolsResultSchema.safeParse(result).success).toBe(false);
    expect(
      ideSymbolsResultSchema.safeParse({
        kind: "symbols",
        source,
        symbols: [
          { name: "x".repeat(maxIdeDiagnosticLabelCodePoints + 1), kind: "unknown", range },
        ],
        stale: false,
        truncated: false,
      }).success,
    ).toBe(false);
  });
});
