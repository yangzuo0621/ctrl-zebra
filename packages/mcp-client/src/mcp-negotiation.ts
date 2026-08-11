import type { DiscoverResult, JSONRPCMessage } from "@modelcontextprotocol/client";

import { type McpClientErrorCode, type McpProtocolMode, mcpProtocolVersion } from "./contracts.js";
import type { SdkStdioTransport } from "./sdk-stdio-transport.js";

const modernMetaKey = "io.modelcontextprotocol/protocolVersion";
const clientInfoMetaKey = "io.modelcontextprotocol/clientInfo";
const clientCapabilitiesMetaKey = "io.modelcontextprotocol/clientCapabilities";
const modernProbeErrorCode = -32_022;
// T1804 keeps the official JSON-RPC parse/request errors as the closed
// specification-defined non-modern probe set. Implementation-defined -320xx
// values remain unknown and therefore cannot authorize a legacy downgrade.
const definedNonModernProbeErrorCodes = new Set([-32_700, -32_600, -32_601, -32_602, -32_603]);
const maxAdvertisedVersions = 64;
const maxVersionLength = 128;
const knownDiscoverKeys = new Set([
  "resultType",
  "supportedVersions",
  "capabilities",
  "instructions",
  "ttlMs",
  "cacheScope",
  "_meta",
]);
const knownModernErrorDataKeys = new Set(["supported", "requested"]);

export interface McpNegotiationOptions {
  readonly mode: McpProtocolMode;
  readonly clientName: string;
  readonly clientVersion: string;
  readonly timeoutMs: number;
  readonly generation: number;
  readonly signal?: AbortSignal;
  readonly isCurrent: () => boolean;
}

export type McpProbeOutcome =
  | {
      readonly kind: "modern";
      readonly version: typeof mcpProtocolVersion;
      readonly discover: DiscoverResult;
    }
  | { readonly kind: "legacy" };

/** Stable package-private failure from the modern-first probe classifier. */
export class McpNegotiationFailure extends Error {
  constructor(
    readonly code: Extract<McpClientErrorCode, "malformed-message" | "protocol-incompatible">,
  ) {
    super(
      code === "malformed-message"
        ? "The MCP Server sent a malformed message."
        : "The MCP Server does not support the required protocol version.",
    );
    this.name = "McpNegotiationFailure";
  }
}

/**
 * Run the bounded modern-first probe on an already host-owned stdio port.
 * The SDK receives the same transport after this function returns; the probe
 * never invokes a second process or hands raw protocol values to callers.
 */
export async function negotiateMcpEra(
  transport: SdkStdioTransport,
  options: McpNegotiationOptions,
): Promise<McpProbeOutcome> {
  await transport.start();
  const first = await exchangeProbe(transport, options, 0, mcpProtocolVersion);
  const firstDecision = classifyProbeReply(first);

  switch (firstDecision.kind) {
    case "timeout":
      if (options.mode === "dual") return { kind: "legacy" };
      throw new McpNegotiationFailure("protocol-incompatible");
    case "legacy":
      if (options.mode === "dual") return { kind: "legacy" };
      throw new McpNegotiationFailure("protocol-incompatible");
    case "modern":
      return firstDecision.outcome;
    case "failure":
      throw new McpNegotiationFailure(firstDecision.code);
    case "modern-error": {
      // A recognized modern UnsupportedProtocolVersion error is modern
      // evidence. Corrective continuation is the SDK/spec path that obtains
      // the complete DiscoverResult before the Client is handed the port.
      const corrected = await exchangeProbe(transport, options, 1, mcpProtocolVersion);
      const correctedDecision = classifyProbeReply(corrected);
      if (correctedDecision.kind === "modern") return correctedDecision.outcome;
      if (correctedDecision.kind === "failure") {
        throw new McpNegotiationFailure(correctedDecision.code);
      }
      throw new McpNegotiationFailure(
        correctedDecision.kind === "timeout" || correctedDecision.kind === "legacy"
          ? "protocol-incompatible"
          : "protocol-incompatible",
      );
    }
  }
}

type ProbeReply =
  | { readonly kind: "result"; readonly value: unknown }
  | { readonly kind: "error"; readonly value: unknown }
  | { readonly kind: "timeout" };

type ProbeDecision =
  | { readonly kind: "modern"; readonly outcome: Extract<McpProbeOutcome, { kind: "modern" }> }
  | { readonly kind: "modern-error" }
  | { readonly kind: "legacy" }
  | { readonly kind: "timeout" }
  | { readonly kind: "failure"; readonly code: "malformed-message" | "protocol-incompatible" };

async function exchangeProbe(
  transport: SdkStdioTransport,
  options: McpNegotiationOptions,
  sequence: number,
  requestedVersion: typeof mcpProtocolVersion,
): Promise<ProbeReply> {
  options.signal?.throwIfAborted();
  const id = `ctrl-zebra-probe:${options.generation}:${sequence}`;
  const request: JSONRPCMessage = {
    jsonrpc: "2.0",
    id,
    method: "server/discover",
    params: {
      _meta: {
        [modernMetaKey]: requestedVersion,
        [clientInfoMetaKey]: { name: options.clientName, version: options.clientVersion },
        [clientCapabilitiesMetaKey]: {},
      },
    },
  } as JSONRPCMessage;

  return new Promise<ProbeReply>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => settle({ kind: "timeout" }), options.timeoutMs);
    const previous = {
      onmessage: transport.onmessage,
      onerror: transport.onerror,
      onclose: transport.onclose,
    };

    const cleanup = (): void => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      if (transport.onmessage === onMessage) transport.onmessage = previous.onmessage;
      if (transport.onerror === onError) transport.onerror = previous.onerror;
      if (transport.onclose === onClose) transport.onclose = previous.onclose;
    };
    const settle = (value: ProbeReply): void => {
      if (settled) return;
      settled = true;
      transport.ignoreResponseId(id);
      cleanup();
      resolve(value);
    };
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      transport.ignoreResponseId(id);
      cleanup();
      reject(error);
    };
    const onMessage = (message: JSONRPCMessage): void => {
      if (!options.isCurrent()) {
        fail(new McpNegotiationFailure("protocol-incompatible"));
        return;
      }
      if (!hasMatchingId(message, id)) {
        if ("result" in message || "error" in message) {
          fail(new McpNegotiationFailure("malformed-message"));
        }
        return;
      }
      if ("result" in message) {
        settle({ kind: "result", value: message.result });
      } else if ("error" in message) {
        settle({ kind: "error", value: message.error });
      } else {
        fail(new McpNegotiationFailure("malformed-message"));
      }
    };
    const onError = (): void => {
      const code = transport.failure;
      fail(new McpNegotiationFailure(toNegotiationCode(code)));
    };
    const onClose = (): void => {
      const code = transport.failure;
      fail(new McpNegotiationFailure(toNegotiationCode(code ?? "server-exited")));
    };
    const onAbort = (): void => {
      fail(options.signal?.reason ?? new Error("MCP probe cancelled."));
    };

    transport.onmessage = onMessage;
    transport.onerror = onError;
    transport.onclose = onClose;
    options.signal?.addEventListener("abort", onAbort, { once: true });

    void transport.send(request).catch((error: unknown) => {
      if (transport.failure !== undefined) {
        onError();
        return;
      }
      fail(error);
    });
  });
}

function classifyProbeReply(reply: ProbeReply): ProbeDecision {
  if (reply.kind === "timeout") return { kind: "timeout" };
  if (reply.kind === "result") {
    const result = validateDiscoverResult(reply.value);
    if (result.kind === "malformed") return { kind: "failure", code: "malformed-message" };
    if (result.kind === "unclassified") return { kind: "failure", code: "protocol-incompatible" };
    if (!result.value.supportedVersions.includes(mcpProtocolVersion)) {
      return { kind: "failure", code: "protocol-incompatible" };
    }
    return {
      kind: "modern",
      outcome: { kind: "modern", version: mcpProtocolVersion, discover: result.value },
    };
  }

  const error = validateProbeError(reply.value);
  if (error.kind === "malformed") return { kind: "failure", code: "malformed-message" };
  if (error.code === modernProbeErrorCode) {
    if (error.modernData === undefined) return { kind: "failure", code: "malformed-message" };
    if (!error.modernData.supported.includes(mcpProtocolVersion)) {
      return { kind: "failure", code: "protocol-incompatible" };
    }
    return { kind: "modern-error" };
  }
  if (definedNonModernProbeErrorCodes.has(error.code)) return { kind: "legacy" };
  return { kind: "failure", code: "protocol-incompatible" };
}

type DiscoverValidation =
  | { readonly kind: "valid"; readonly value: DiscoverResult }
  | { readonly kind: "malformed" }
  | { readonly kind: "unclassified" };

function validateDiscoverResult(value: unknown): DiscoverValidation {
  if (!isRecord(value) || !hasOnlyKeys(value, knownDiscoverKeys)) return { kind: "malformed" };
  if (typeof value.resultType !== "string") return { kind: "malformed" };
  if (value.resultType !== "complete") return { kind: "unclassified" };
  const supportedVersions = value.supportedVersions;
  if (
    !Array.isArray(supportedVersions) ||
    supportedVersions.length === 0 ||
    supportedVersions.length > maxAdvertisedVersions ||
    !supportedVersions.every(
      (version) =>
        typeof version === "string" && version.length > 0 && version.length <= maxVersionLength,
    )
  ) {
    return { kind: "malformed" };
  }
  if (!isRecord(value.capabilities) || !validateServerCapabilities(value.capabilities)) {
    return { kind: "malformed" };
  }
  if (value.instructions !== undefined && typeof value.instructions !== "string") {
    return { kind: "malformed" };
  }
  if (
    value.ttlMs !== undefined &&
    (!Number.isSafeInteger(value.ttlMs) || (value.ttlMs as number) < 0)
  ) {
    return { kind: "malformed" };
  }
  if (
    value.cacheScope !== undefined &&
    value.cacheScope !== "public" &&
    value.cacheScope !== "private"
  ) {
    return { kind: "malformed" };
  }
  if (value._meta !== undefined && !isRecord(value._meta)) return { kind: "malformed" };
  return { kind: "valid", value: value as DiscoverResult };
}

function validateServerCapabilities(value: Readonly<Record<string, unknown>>): boolean {
  for (const key of ["logging", "completions"] as const) {
    if (value[key] !== undefined && !isRecord(value[key])) return false;
  }
  for (const key of ["experimental", "extensions"] as const) {
    const nested = value[key];
    if (nested === undefined) continue;
    if (!isRecord(nested)) return false;
    if (Object.values(nested).some((entry) => !isRecord(entry))) return false;
  }
  for (const key of ["prompts", "resources", "tools"] as const) {
    const capability = value[key];
    if (capability === undefined) continue;
    if (!isRecord(capability)) return false;
    const booleanKeys =
      key === "resources" ? (["listChanged", "subscribe"] as const) : (["listChanged"] as const);
    for (const booleanKey of booleanKeys) {
      if (capability[booleanKey] !== undefined && typeof capability[booleanKey] !== "boolean") {
        return false;
      }
    }
  }
  return value.tasks === undefined || isRecord(value.tasks);
}

type ProbeErrorValidation =
  | {
      readonly kind: "valid";
      readonly code: number;
      readonly modernData?: { readonly supported: readonly string[]; readonly requested: string };
    }
  | { readonly kind: "malformed" };

function validateProbeError(value: unknown): ProbeErrorValidation {
  if (!isRecord(value)) return { kind: "malformed" };
  if (typeof value.code !== "number" || !Number.isSafeInteger(value.code))
    return { kind: "malformed" };
  if (typeof value.message !== "string" || value.message.length === 0) return { kind: "malformed" };
  if (value.code !== modernProbeErrorCode) return { kind: "valid", code: value.code };
  if (!isRecord(value.data) || !hasOnlyKeys(value.data, knownModernErrorDataKeys)) {
    return { kind: "malformed" };
  }
  const supported = value.data.supported;
  const requested = value.data.requested;
  if (
    !Array.isArray(supported) ||
    supported.length === 0 ||
    supported.length > maxAdvertisedVersions ||
    !supported.every(
      (version) =>
        typeof version === "string" && version.length > 0 && version.length <= maxVersionLength,
    ) ||
    typeof requested !== "string" ||
    requested.length === 0 ||
    requested.length > maxVersionLength
  ) {
    return { kind: "malformed" };
  }
  return { kind: "valid", code: value.code, modernData: { supported, requested } };
}

function hasMatchingId(message: JSONRPCMessage, id: string): boolean {
  return "id" in message && message.id === id;
}

function hasOnlyKeys(value: Readonly<Record<string, unknown>>, keys: Set<string>): boolean {
  return Object.keys(value).every((key) => keys.has(key));
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toNegotiationCode(
  code: McpClientErrorCode | undefined,
): "malformed-message" | "protocol-incompatible" {
  return code === "malformed-message" ? code : "protocol-incompatible";
}
