import { describe, expect, it } from "vitest";

import {
  diagnosticsExportDocumentSchema,
  maxDiagnosticsExportBytes,
  serializeDiagnosticsExport,
} from "./diagnostics-export.js";
import { utf8ByteLength } from "./text-primitives.js";

const validDocument = {
  formatVersion: 1 as const,
  extensionVersion: "0.1.1",
  vscodeVersion: "1.125.0",
  platform: "win32" as const,
  provider: "openai" as const,
  errors: [{ category: "configuration" as const, count: 2 }],
  mcp: {
    status: "disconnected" as const,
    generation: 0,
  },
  runtime: {
    activationDurationMs: 12,
    firstWebviewDisplayDurationMs: 34,
    memoryBytes: 52_428_800,
    runStatus: "idle" as const,
  },
};

describe("diagnostics export document", () => {
  it("accepts the safe allowlisted shape and serializes deterministic UTF-8 JSON", () => {
    const result = serializeDiagnosticsExport(validDocument);

    expect(result.document).toEqual(validDocument);
    expect(result.json).toBe(`${JSON.stringify(validDocument)}\n`);
    expect(result.bytes.byteLength).toBeLessThanOrEqual(maxDiagnosticsExportBytes);
    expect(result.bytes.byteLength).toBe(utf8ByteLength(result.json));
  });

  it("encodes multi-byte UTF-8 content exactly, across every UTF-8 width", () => {
    const result = serializeDiagnosticsExport({
      ...validDocument,
      extensionVersion: "A¢€😀",
    });

    expect(result.bytes).toEqual(new TextEncoder().encode(result.json));
    expect(result.bytes.byteLength).toBe(utf8ByteLength(result.json));
  });

  it("rejects unknown fields so secrets and content cannot enter the export contract", () => {
    expect(
      diagnosticsExportDocumentSchema.safeParse({
        ...validDocument,
        endpoint: "https://example.invalid?api_key=secret",
        conversation: "private source",
      }).success,
    ).toBe(false);
  });

  it("keeps the bounded document below the serialized byte ceiling", () => {
    const result = serializeDiagnosticsExport({
      ...validDocument,
      extensionVersion: "v".repeat(128),
      vscodeVersion: "w".repeat(128),
      errors: Array.from({ length: 9 }, (_, index) => ({
        category: "internal" as const,
        count: index + 1,
      })),
      runtime: {
        ...validDocument.runtime,
        runStatus: "unknown" as const,
      },
    });

    expect(result.bytes.byteLength).toBeLessThanOrEqual(maxDiagnosticsExportBytes);
  });
});
