import { z } from "zod";

import {
  mcpLegacyProtocolVersionSchema,
  mcpNegotiatedSchema,
  mcpProtocolModeSchema,
  mcpProtocolVersionSchema,
} from "./mcp-negotiation.js";
import { mcpGenerationSchema, mcpServerIdentitySchema, mcpServerIdSchema } from "./mcp-resource.js";
import { toolNameSchema } from "./tool.js";

export type {
  McpNegotiatedDto,
  McpNegotiatedProvenanceDto,
  McpProtocolMode,
} from "./mcp-negotiation.js";
export {
  mcpLegacyProtocolVersionSchema,
  mcpNegotiatedProvenanceSchema,
  mcpNegotiatedSchema,
  mcpProtocolModeSchema,
  mcpProtocolVersionSchema,
} from "./mcp-negotiation.js";

const maxMcpToolNameCodePoints = 65_536;
const mcpToolNameSchema = z
  .string()
  .min(1)
  .max(maxMcpToolNameCodePoints)
  .refine((value) => value.isWellFormed(), "Tool names must contain well-formed Unicode.")
  .refine(
    (value) => [...value].length <= maxMcpToolNameCodePoints,
    `Tool names must not exceed ${maxMcpToolNameCodePoints} Unicode code points.`,
  );
export const mcpCapabilitiesSchema = z.strictObject({
  tools: z.boolean(),
  toolsListChanged: z.boolean(),
  resources: z.boolean(),
  resourceTemplates: z.boolean(),
  resourcesListChanged: z.boolean(),
  prompts: z.boolean(),
  promptsListChanged: z.boolean(),
});
export const mcpErrorCodeSchema = z.enum([
  "configuration-invalid",
  "workspace-untrusted",
  "approval-denied",
  "approval-expired",
  "approval-invalidated",
  "spawn-failed",
  "connect-failed",
  "protocol-incompatible",
  "capability-unsupported",
  "malformed-message",
  "invalid-schema",
  "limit-exceeded",
  "server-exited",
  "disconnected",
  "termination-unconfirmed",
  "tool-unavailable",
  "tool-invalid-input",
  "tool-failed",
  "tool-invalid-output",
  "resource-unavailable",
  "resource-unsupported",
  "prompt-unavailable",
  "prompt-unsupported",
  "internal",
]);
export const mcpErrorSchema = z.strictObject({
  code: mcpErrorCodeSchema,
  message: z.string().min(1).max(1_024),
});

const connectionBase = {
  generation: z.number().int().nonnegative().safe(),
  server: mcpServerIdentitySchema.optional(),
  configurationStale: z.boolean(),
};
export const mcpConnectionSchema = z.discriminatedUnion("status", [
  z.strictObject({ ...connectionBase, status: z.literal("disconnected") }),
  z.strictObject({ ...connectionBase, status: z.literal("connecting") }),
  z.strictObject({ ...connectionBase, status: z.literal("disconnecting") }),
  z.strictObject({
    ...connectionBase,
    status: z.literal("connected"),
    server: mcpServerIdentitySchema,
    generation: mcpGenerationSchema,
    protocolVersion: mcpProtocolVersionSchema,
    capabilities: mcpCapabilitiesSchema,
  }),
  z.strictObject({
    ...connectionBase,
    status: z.literal("failed"),
    error: mcpErrorSchema,
  }),
]);

const unavailableMcpCapabilitiesSchema = z.strictObject({
  tools: z.literal(false),
  toolsListChanged: z.literal(false),
  resources: z.literal(false),
  resourceTemplates: z.literal(false),
  resourcesListChanged: z.literal(false),
  prompts: z.literal(false),
  promptsListChanged: z.literal(false),
});
// The Extension can publish a safe, unconfigured boot/failure projection before
// a validated Server identity exists. Connected projections remain strict below.
const negotiatedConnectionBase = {
  server: mcpServerIdentitySchema.optional(),
  generation: z.number().int().nonnegative().safe(),
  configuredMode: mcpProtocolModeSchema,
  configurationStale: z.boolean(),
};

/**
 * Negotiated T1807 projection contract. Inactive boot/failure states may omit
 * the Server identity until configuration has been validated; no capabilities
 * or negotiated era/version are exposed in those states.
 */
export const mcpNegotiatedConnectionSchema = z
  .discriminatedUnion("status", [
    z.strictObject({
      ...negotiatedConnectionBase,
      status: z.literal("disconnected"),
      capabilities: unavailableMcpCapabilitiesSchema,
    }),
    z.strictObject({
      ...negotiatedConnectionBase,
      status: z.literal("connecting"),
      capabilities: unavailableMcpCapabilitiesSchema,
    }),
    z.strictObject({
      ...negotiatedConnectionBase,
      status: z.literal("disconnecting"),
      capabilities: unavailableMcpCapabilitiesSchema,
    }),
    z.strictObject({
      ...negotiatedConnectionBase,
      status: z.literal("connected"),
      negotiated: mcpNegotiatedSchema,
      capabilities: mcpCapabilitiesSchema,
    }),
    z.strictObject({
      ...negotiatedConnectionBase,
      status: z.literal("failed"),
      capabilities: unavailableMcpCapabilitiesSchema,
      error: mcpErrorSchema,
    }),
  ])
  .superRefine((connection, context) => {
    if (
      connection.status === "connected" &&
      connection.configuredMode === "modern-only" &&
      connection.negotiated.era !== "modern"
    ) {
      context.addIssue({
        code: "custom",
        path: ["negotiated"],
        message: "modern-only connections cannot carry legacy provenance.",
      });
    }
  });
export const mcpConnectionProjectionSchema = mcpNegotiatedConnectionSchema;

export const mcpToolDescriptorSchema = z.strictObject({
  server: mcpServerIdentitySchema,
  generation: mcpGenerationSchema,
  registryName: toolNameSchema,
  mcpToolName: mcpToolNameSchema,
  title: z.string().max(65_536).optional(),
  description: z.string().max(65_536).optional(),
});
export const mcpToolCatalogSchema = z.strictObject({
  server: mcpServerIdentitySchema,
  generation: mcpGenerationSchema,
  tools: z.array(mcpToolDescriptorSchema).max(1_000),
});
export const mcpToolRejectionReasonSchema = z.enum([
  "forbidden-keyword",
  "unknown-keyword",
  "invalid-reference",
  "non-object-root",
  "schema-invalid",
  "limit-exceeded",
]);
export const mcpRejectedToolSchema = z.strictObject({
  mcpToolName: mcpToolNameSchema,
  reason: mcpToolRejectionReasonSchema,
});
export const mcpCatalogSequenceSchema = z.number().int().positive().safe();
export const mcpToolCatalogProjectionSchema = z.strictObject({
  server: mcpServerIdentitySchema,
  generation: mcpGenerationSchema,
  tools: z.array(mcpToolDescriptorSchema).max(1_000),
  rejectedTools: z.array(mcpRejectedToolSchema).max(256),
  rejectedToolsTruncated: z.boolean(),
});

export const maxMcpDiagnosticSkippedTools = 256;
export const mcpDiagnosticRecoveryActionSchema = z.enum([
  "refresh-tools",
  "reconnect",
  "open-settings",
]);
export const mcpDiagnosticToolEntrySchema = mcpRejectedToolSchema;
const mcpDiagnosticSourceShape = {
  server: mcpServerIdentitySchema,
  generation: mcpGenerationSchema,
};
const mcpDiagnosticSkippedToolsShape = {
  skippedTools: z.array(mcpDiagnosticToolEntrySchema).max(maxMcpDiagnosticSkippedTools),
  skippedToolsTruncated: z.boolean(),
};
const mcpToolDiscoveryFailureCodeSchema = z.enum([
  "invalid-schema",
  "limit-exceeded",
  "malformed-message",
]);
const mcpToolRejectionsDiagnosticSchema = z.discriminatedUnion("outcome", [
  z.strictObject({
    kind: z.literal("tool-rejections"),
    outcome: z.literal("degraded"),
    ...mcpDiagnosticSourceShape,
    connectionStatus: z.literal("connected"),
    ...mcpDiagnosticSkippedToolsShape,
    recoveryAction: z.literal("refresh-tools"),
  }),
  z.strictObject({
    kind: z.literal("tool-rejections"),
    outcome: z.literal("all-rejected"),
    ...mcpDiagnosticSourceShape,
    connectionStatus: z.literal("failed"),
    ...mcpDiagnosticSkippedToolsShape,
    recoveryAction: z.literal("reconnect"),
  }),
  z.strictObject({
    kind: z.literal("tool-rejections"),
    outcome: z.literal("refresh-all-rejected"),
    ...mcpDiagnosticSourceShape,
    connectionStatus: z.literal("connected"),
    ...mcpDiagnosticSkippedToolsShape,
    recoveryAction: z.literal("refresh-tools"),
  }),
]);
const mcpToolDiscoveryFailureDiagnosticSchema = z.discriminatedUnion("outcome", [
  z.strictObject({
    kind: z.literal("tool-discovery-failure"),
    outcome: z.literal("initial"),
    ...mcpDiagnosticSourceShape,
    connectionStatus: z.literal("failed"),
    code: mcpToolDiscoveryFailureCodeSchema,
    recoveryAction: z.literal("reconnect"),
  }),
  z.strictObject({
    kind: z.literal("tool-discovery-failure"),
    outcome: z.literal("refresh"),
    ...mcpDiagnosticSourceShape,
    connectionStatus: z.literal("connected"),
    code: mcpToolDiscoveryFailureCodeSchema,
    recoveryAction: z.literal("refresh-tools"),
  }),
]);
export const mcpDiagnosticsProjectionSchema = z.union([
  mcpToolRejectionsDiagnosticSchema,
  mcpToolDiscoveryFailureDiagnosticSchema,
  z.strictObject({
    kind: z.literal("protocol-incompatible"),
    ...mcpDiagnosticSourceShape,
    connectionStatus: z.literal("failed"),
    configuredMode: z.literal("modern-only"),
    supportedVersions: z.tuple([mcpProtocolVersionSchema]),
    connectionEstablished: z.literal(false),
    nextStep: z.literal("open-settings"),
  }),
  z.strictObject({
    kind: z.literal("protocol-incompatible"),
    ...mcpDiagnosticSourceShape,
    connectionStatus: z.literal("failed"),
    configuredMode: z.literal("dual"),
    supportedVersions: z.tuple([mcpProtocolVersionSchema, mcpLegacyProtocolVersionSchema]),
    connectionEstablished: z.literal(false),
    nextStep: z.literal("open-settings"),
  }),
  z.strictObject({
    kind: z.literal("clear"),
    ...mcpDiagnosticSourceShape,
  }),
]);
export const toolStateSourceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("builtin") }),
  z.strictObject({
    kind: z.literal("mcp"),
    server: mcpServerIdentitySchema,
    generation: mcpGenerationSchema,
    mcpToolName: mcpToolNameSchema,
  }),
]);

export type McpConnectionDto = z.infer<typeof mcpConnectionSchema>;
export type McpNegotiatedConnectionDto = z.infer<typeof mcpNegotiatedConnectionSchema>;
export type McpConnectionProjectionDto = z.infer<typeof mcpConnectionProjectionSchema>;
export type McpToolCatalogDto = z.infer<typeof mcpToolCatalogSchema>;
export type McpToolCatalogProjectionDto = z.infer<typeof mcpToolCatalogProjectionSchema>;
export type McpToolRejectionReasonDto = z.infer<typeof mcpToolRejectionReasonSchema>;
export type McpRejectedToolDto = z.infer<typeof mcpRejectedToolSchema>;
export type McpDiagnosticRecoveryActionDto = z.infer<typeof mcpDiagnosticRecoveryActionSchema>;
export type McpDiagnosticToolEntryDto = z.infer<typeof mcpDiagnosticToolEntrySchema>;
export type McpDiagnosticsProjectionDto = z.infer<typeof mcpDiagnosticsProjectionSchema>;
export type ToolStateSourceDto = z.infer<typeof toolStateSourceSchema>;
export { mcpServerIdSchema };
