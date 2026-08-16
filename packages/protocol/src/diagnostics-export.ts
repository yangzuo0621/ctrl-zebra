import { z } from "zod";

import { utf8ByteLength, utf8Encode } from "./text-primitives.js";

/** The version of the user-triggered, local diagnostics document. */
export const diagnosticsExportFormatVersion = 1 as const;

/** The complete export is deliberately much smaller than the existing message ceiling. */
export const maxDiagnosticsExportBytes = 64 * 1024;
export const maxDiagnosticsExportVersionCodePoints = 128;
export const maxDiagnosticsExportErrorEntries = 9;
export const maxDiagnosticsExportErrorCount = 1_000;
export const maxDiagnosticsExportRuntimeInteger = 1_000_000_000_000;

export const diagnosticsExportPlatformSchema = z.enum([
  "aix",
  "android",
  "cygwin",
  "darwin",
  "freebsd",
  "haiku",
  "linux",
  "netbsd",
  "openbsd",
  "sunos",
  "win32",
  "unknown",
]);

export const diagnosticsExportProviderSchema = z.enum([
  "openai",
  "gemini",
  "openai-compatible",
  "unknown",
]);

export const diagnosticsExportErrorCategorySchema = z.enum([
  "configuration",
  "authentication",
  "network",
  "rate-limit",
  "context",
  "budget",
  "tool",
  "mcp",
  "internal",
]);

export const diagnosticsExportMcpStatusSchema = z.enum([
  "unconfigured",
  "disconnected",
  "connecting",
  "connected",
  "disconnecting",
  "failed",
  "unknown",
]);

export const diagnosticsExportRunStatusSchema = z.enum([
  "idle",
  "preparing",
  "streaming",
  "awaiting_approval",
  "executing_tool",
  "completed",
  "truncated",
  "cancelled",
  "budget-exceeded",
  "failed",
  "interrupted",
  "unknown",
]);

const boundedVersionSchema = z
  .string()
  .min(1)
  .max(maxDiagnosticsExportVersionCodePoints)
  .refine((value) => value.isWellFormed(), "Version values must contain well-formed Unicode.")
  .refine(
    (value) => !/[\0\r\n\u2028\u2029]/u.test(value),
    "Version values must not contain control characters.",
  );

const boundedRuntimeIntegerSchema = z
  .number()
  .int()
  .nonnegative()
  .max(maxDiagnosticsExportRuntimeInteger)
  .safe();

export const diagnosticsExportErrorEntrySchema = z.strictObject({
  category: diagnosticsExportErrorCategorySchema,
  count: z.number().int().positive().max(maxDiagnosticsExportErrorCount).safe(),
});

export const diagnosticsExportMcpSchema = z.strictObject({
  status: diagnosticsExportMcpStatusSchema,
  generation: boundedRuntimeIntegerSchema,
  protocolMode: z.enum(["modern-only", "dual"]).optional(),
  negotiatedVersion: z.enum(["2026-07-28", "2025-11-25"]).optional(),
  errorCategory: z.literal("mcp").optional(),
});

export const diagnosticsExportRuntimeSchema = z.strictObject({
  activationDurationMs: boundedRuntimeIntegerSchema,
  firstWebviewDisplayDurationMs: boundedRuntimeIntegerSchema.optional(),
  memoryBytes: boundedRuntimeIntegerSchema,
  runStatus: diagnosticsExportRunStatusSchema,
});

export const diagnosticsExportDocumentSchema = z.strictObject({
  formatVersion: z.literal(diagnosticsExportFormatVersion),
  extensionVersion: boundedVersionSchema,
  vscodeVersion: boundedVersionSchema,
  platform: diagnosticsExportPlatformSchema,
  provider: diagnosticsExportProviderSchema,
  errors: z.array(diagnosticsExportErrorEntrySchema).max(maxDiagnosticsExportErrorEntries),
  mcp: diagnosticsExportMcpSchema,
  runtime: diagnosticsExportRuntimeSchema,
});

export type DiagnosticsExportPlatform = z.infer<typeof diagnosticsExportPlatformSchema>;
export type DiagnosticsExportProvider = z.infer<typeof diagnosticsExportProviderSchema>;
export type DiagnosticsExportErrorCategory = z.infer<typeof diagnosticsExportErrorCategorySchema>;
export type DiagnosticsExportMcp = z.infer<typeof diagnosticsExportMcpSchema>;
export type DiagnosticsExportRunStatus = z.infer<typeof diagnosticsExportRunStatusSchema>;
export type DiagnosticsExportRuntime = z.infer<typeof diagnosticsExportRuntimeSchema>;
export type DiagnosticsExportDocument = z.infer<typeof diagnosticsExportDocumentSchema>;

export interface SerializedDiagnosticsExport {
  readonly document: DiagnosticsExportDocument;
  readonly json: string;
  readonly bytes: Uint8Array;
}

/**
 * Serializes only a validated diagnostic document. The newline is part of the stable file format,
 * and the byte ceiling is checked after UTF-8 encoding rather than by JavaScript string length.
 */
export function serializeDiagnosticsExport(
  document: DiagnosticsExportDocument,
): SerializedDiagnosticsExport {
  const parsed = diagnosticsExportDocumentSchema.parse(document);
  const json = `${JSON.stringify(parsed)}\n`;
  const bytes = utf8Encode(json);
  if (utf8ByteLength(json) > maxDiagnosticsExportBytes) {
    throw new RangeError("The diagnostics export exceeds its serialized byte limit.");
  }
  return { document: parsed, json, bytes };
}
