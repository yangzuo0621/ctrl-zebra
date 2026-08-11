import { z } from "zod";

export const mcpProtocolVersionSchema = z.literal("2026-07-28");
export const mcpLegacyProtocolVersionSchema = z.literal("2025-11-25");
export const mcpProtocolModeSchema = z.enum(["modern-only", "dual"]);

export const mcpNegotiatedSchema = z.discriminatedUnion("era", [
  z.strictObject({
    era: z.literal("modern"),
    version: mcpProtocolVersionSchema,
  }),
  z.strictObject({
    era: z.literal("legacy"),
    version: mcpLegacyProtocolVersionSchema,
  }),
]);

export const mcpNegotiatedProvenanceSchema = z.discriminatedUnion("negotiatedEra", [
  z.strictObject({
    configuredMode: mcpProtocolModeSchema,
    negotiatedEra: z.literal("modern"),
    negotiatedVersion: mcpProtocolVersionSchema,
  }),
  z.strictObject({
    configuredMode: z.literal("dual"),
    negotiatedEra: z.literal("legacy"),
    negotiatedVersion: mcpLegacyProtocolVersionSchema,
  }),
]);

export type McpNegotiatedDto = z.infer<typeof mcpNegotiatedSchema>;
export type McpNegotiatedProvenanceDto = z.infer<typeof mcpNegotiatedProvenanceSchema>;
export type McpProtocolMode = z.infer<typeof mcpProtocolModeSchema>;
