import { z } from "zod";

import { mcpGenerationSchema, mcpServerIdentitySchema, mcpServerIdSchema } from "./mcp-resource.js";
import { toolNameSchema } from "./tool.js";

export const mcpProtocolVersionSchema = z.literal("2026-07-28");
const maxMcpToolNameCodePoints = 65_536;
const mcpToolNameSchema = z
  .string()
  .min(1)
  .max(maxMcpToolNameCodePoints)
  .refine(isWellFormedUnicode, "Tool names must contain well-formed Unicode.")
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
export type McpToolCatalogDto = z.infer<typeof mcpToolCatalogSchema>;
export type McpToolCatalogProjectionDto = z.infer<typeof mcpToolCatalogProjectionSchema>;
export type McpToolRejectionReasonDto = z.infer<typeof mcpToolRejectionReasonSchema>;
export type McpRejectedToolDto = z.infer<typeof mcpRejectedToolSchema>;
export type ToolStateSourceDto = z.infer<typeof toolStateSourceSchema>;
export { mcpServerIdSchema };

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    }
  }
  return true;
}
