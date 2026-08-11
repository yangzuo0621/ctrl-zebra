import { z } from "zod";

import { mcpGenerationSchema, mcpServerIdentitySchema, mcpServerIdSchema } from "./mcp-resource.js";
import { toolNameSchema } from "./tool.js";

export const mcpProtocolVersionSchema = z.literal("2026-07-28");
const maxMcpToolNameCodePoints = 65_536;
const maxMcpRejectionProjectionBytes = 1_048_576;
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
export const mcpToolRejectionCatalogSchema = z
  .strictObject({
    server: mcpServerIdentitySchema,
    generation: mcpGenerationSchema,
    rejectedTools: z.array(mcpRejectedToolSchema).max(256),
    rejectedToolsTruncated: z.boolean(),
  })
  .superRefine(({ rejectedTools }, context) => {
    if (utf8ByteLength(JSON.stringify(rejectedTools)) > maxMcpRejectionProjectionBytes) {
      context.addIssue({
        code: "custom",
        message: "MCP Tool rejection projection exceeds the serialized byte limit.",
      });
    }
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
export type McpToolRejectionReasonDto = z.infer<typeof mcpToolRejectionReasonSchema>;
export type McpRejectedToolDto = z.infer<typeof mcpRejectedToolSchema>;
export type McpToolRejectionCatalogDto = z.infer<typeof mcpToolRejectionCatalogSchema>;
export type ToolStateSourceDto = z.infer<typeof toolStateSourceSchema>;
export { mcpServerIdSchema };

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return bytes;
}

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
