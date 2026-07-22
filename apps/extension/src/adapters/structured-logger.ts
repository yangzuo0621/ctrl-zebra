const maxFieldLength = 128;
const maxSerializedEntryBytes = 4_096;
const redactedValue = "[REDACTED]";

const orderedStringFields = [
  "event",
  "component",
  "outcome",
  "errorCode",
  "provider",
  "sessionId",
  "runId",
  "requestId",
  "toolCallId",
  "approvalId",
] as const;

const orderedNumberFields = ["durationMs", "memoryBytes", "attempt"] as const;
const categoricalFields = new Set(["outcome", "errorCode", "provider"]);

type StructuredLogLevel = "trace" | "debug" | "info" | "warn" | "error";

interface LogOutputChannelAdapter {
  trace(message: string): void;
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  dispose(): void;
}

export interface StructuredLogger {
  trace(entry: unknown): void;
  debug(entry: unknown): void;
  info(entry: unknown): void;
  warn(entry: unknown): void;
  error(entry: unknown): void;
  dispose(): void;
}

export function createStructuredLogger(channel: LogOutputChannelAdapter): StructuredLogger {
  const write = (level: StructuredLogLevel, entry: unknown): void => {
    channel[level](formatStructuredLogEntry(entry));
  };

  return {
    trace: (entry) => write("trace", entry),
    debug: (entry) => write("debug", entry),
    info: (entry) => write("info", entry),
    warn: (entry) => write("warn", entry),
    error: (entry) => write("error", entry),
    dispose: () => channel.dispose(),
  };
}

export function formatStructuredLogEntry(input: unknown): string {
  const source = getDataProperties(input);
  const event = readRequiredToken(source, "event", true);
  const component = readRequiredToken(source, "component", false);

  if (event === undefined || component === undefined) {
    return invalidEntry;
  }

  const entry: Record<string, string | number> = { event, component };

  for (const field of orderedStringFields) {
    if (field === "event" || field === "component") {
      continue;
    }

    const value = readOptionalString(source, field, categoricalFields.has(field));
    if (value !== undefined) {
      entry[field] = value;
    }
  }

  for (const field of orderedNumberFields) {
    const value = readOptionalNumber(source, field);
    if (value !== undefined) {
      entry[field] = value;
    }
  }

  const serialized = JSON.stringify(entry);
  return Buffer.byteLength(serialized, "utf8") <= maxSerializedEntryBytes
    ? serialized
    : invalidEntry;
}

const invalidEntry = JSON.stringify({
  event: "invalid_log_entry",
  component: "structured_logger",
  outcome: "rejected",
  errorCode: "invalid_entry",
});

function getDataProperties(input: unknown): Readonly<Record<string, unknown>> | undefined {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }

  try {
    const properties: Record<string, unknown> = {};
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

function readRequiredToken(
  source: Readonly<Record<string, unknown>> | undefined,
  field: string,
  snakeCase: boolean,
): string | undefined {
  const value = source?.[field];
  if (typeof value !== "string" || value.length === 0 || value.length > maxFieldLength) {
    return undefined;
  }

  const tokenPattern = snakeCase ? /^[a-z][a-z0-9_]*$/u : /^[a-z][a-z0-9_-]*$/u;
  return tokenPattern.test(value) ? redact(value) : undefined;
}

function readOptionalString(
  source: Readonly<Record<string, unknown>> | undefined,
  field: string,
  categorical: boolean,
): string | undefined {
  const value = source?.[field];
  if (typeof value !== "string" || value.length === 0 || value.length > maxFieldLength) {
    return undefined;
  }
  if (categorical && !/^[a-z][a-z0-9_-]*$/u.test(value)) {
    return undefined;
  }
  return redact(value);
}

function readOptionalNumber(
  source: Readonly<Record<string, unknown>> | undefined,
  field: string,
): number | undefined {
  const value = source?.[field];
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function redact(value: string): string {
  return containsSensitiveValue(value) ? redactedValue : value;
}

function containsSensitiveValue(value: string): boolean {
  return (
    /(?:authorization|api[_-]?key|bearer|password|secret|token)/iu.test(value) ||
    /\bsk-[a-z0-9_-]{8,}\b/iu.test(value) ||
    /\bAIza[a-z0-9_-]{8,}\b/u.test(value)
  );
}
