import {
  type DiagnosticsExportDocument,
  diagnosticsExportErrorCategorySchema,
  diagnosticsExportMcpStatusSchema,
  diagnosticsExportPlatformSchema,
  diagnosticsExportProviderSchema,
  diagnosticsExportRunStatusSchema,
  maxDiagnosticsExportErrorCount,
  maxDiagnosticsExportErrorEntries,
  maxDiagnosticsExportRuntimeInteger,
  type SerializedDiagnosticsExport,
  serializeDiagnosticsExport,
} from "@ctrl-zebra/protocol";

import type { PerformanceBaselineSnapshot } from "./performance-baseline.js";

const redactedValue = "[REDACTED]";
const supportedProtocolModes = new Set(["modern-only", "dual"]);
const supportedNegotiatedVersions = new Set(["2026-07-28", "2025-11-25"]);

export interface DiagnosticsExportBuilderInput {
  readonly extensionVersion: unknown;
  readonly vscodeVersion: unknown;
  readonly platform: unknown;
  readonly provider: unknown;
  readonly errors: readonly unknown[];
  readonly mcp: unknown;
  readonly runtime: unknown;
}

/**
 * Builds the export from an explicit allowlist. Unknown fields are never copied, even when a
 * caller passes a configuration, error, or runtime object that contains private data.
 */
export function createDiagnosticsExport(
  input: DiagnosticsExportBuilderInput,
): SerializedDiagnosticsExport {
  const source = readDataProperties(input);
  const document = buildDocument(source);
  return serializeDiagnosticsExport(document);
}

function buildDocument(
  source: Readonly<Record<string, unknown>> | undefined,
): DiagnosticsExportDocument {
  const runtime = readDataProperties(source?.runtime);
  const mcp = readDataProperties(source?.mcp);
  const errors = collectErrors(source?.errors);

  return {
    formatVersion: 1,
    extensionVersion: safeVersion(source?.extensionVersion),
    vscodeVersion: safeVersion(source?.vscodeVersion),
    platform: safeEnum(source?.platform, diagnosticsExportPlatformSchema, "unknown"),
    provider: safeEnum(source?.provider, diagnosticsExportProviderSchema, "unknown"),
    errors,
    mcp: {
      status: safeEnum(
        source?.mcp === undefined ? undefined : mcp?.status,
        diagnosticsExportMcpStatusSchema,
        "unknown",
      ),
      generation: safeInteger(mcp?.generation),
      ...(supportedProtocolModes.has(mcp?.protocolMode as string)
        ? { protocolMode: mcp?.protocolMode as "modern-only" | "dual" }
        : {}),
      ...(supportedNegotiatedVersions.has(mcp?.negotiatedVersion as string)
        ? { negotiatedVersion: mcp?.negotiatedVersion as "2026-07-28" | "2025-11-25" }
        : {}),
      ...(mcp?.errorCategory === "mcp" ? { errorCategory: "mcp" as const } : {}),
    },
    runtime: {
      activationDurationMs: safeInteger(runtime?.activationDurationMs),
      ...(runtime?.firstWebviewDisplayDurationMs === undefined
        ? {}
        : { firstWebviewDisplayDurationMs: safeInteger(runtime.firstWebviewDisplayDurationMs) }),
      memoryBytes: safeInteger(runtime?.memoryBytes),
      runStatus: safeEnum(runtime?.runStatus, diagnosticsExportRunStatusSchema, "unknown"),
    },
  };
}

export function toDiagnosticsRuntime(
  snapshot: PerformanceBaselineSnapshot,
  runStatus: unknown = "idle",
): Record<string, unknown> {
  return {
    activationDurationMs: snapshot.activationDurationMs,
    ...(snapshot.firstWebviewDisplayDurationMs === undefined
      ? {}
      : { firstWebviewDisplayDurationMs: snapshot.firstWebviewDisplayDurationMs }),
    memoryBytes: snapshot.memoryBytes,
    runStatus,
  };
}

function collectErrors(value: unknown): DiagnosticsExportDocument["errors"] {
  if (!Array.isArray(value)) {
    return [];
  }

  let items: readonly unknown[];
  try {
    items = value.slice(0, maxDiagnosticsExportErrorEntries * 4);
  } catch {
    return [];
  }

  const totals = new Map<DiagnosticsExportDocument["errors"][number]["category"], number>();
  for (const item of items) {
    const source = readDataProperties(item);
    const category = diagnosticsExportErrorCategorySchema.safeParse(source?.category);
    if (!category.success) {
      continue;
    }
    const count = safeInteger(source?.count);
    if (count === 0) {
      continue;
    }
    const current = totals.get(category.data) ?? 0;
    totals.set(category.data, Math.min(maxDiagnosticsExportErrorCount, current + count));
  }

  return [...totals.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .slice(0, maxDiagnosticsExportErrorEntries)
    .map(([category, count]) => ({ category, count }));
}

function safeVersion(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 128 ||
    !value.isWellFormed() ||
    /[\0\r\n\u2028\u2029]/u.test(value)
  ) {
    return "unknown";
  }
  return containsSensitiveValue(value) ? redactedValue : value;
}

function safeInteger(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? Math.min(value, maxDiagnosticsExportRuntimeInteger)
    : 0;
}

function safeEnum<T extends string>(
  value: unknown,
  schema: { safeParse: (value: unknown) => { success: boolean; data?: T } },
  fallback: T,
): T {
  const parsed = schema.safeParse(value);
  return parsed.success && parsed.data !== undefined ? parsed.data : fallback;
}

function readDataProperties(input: unknown): Readonly<Record<string, unknown>> | undefined {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }

  try {
    const properties = Object.create(null) as Record<string, unknown>;
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(input))) {
      if ("value" in descriptor) {
        properties[key] = descriptor.value;
      }
    }
    return properties;
  } catch {
    return undefined;
  }
}

function containsSensitiveValue(value: string): boolean {
  return (
    /(?:authorization|api[_-]?key|bearer|cookie|password|proxy[_-]?authorization|secret|token)/iu.test(
      value,
    ) || /\b(?:sk|AIza)[-_a-z0-9]{8,}\b/iu.test(value)
  );
}
