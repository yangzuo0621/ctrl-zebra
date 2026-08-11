import { z } from "zod";

import { mcpNegotiatedProvenanceSchema } from "./mcp-negotiation.js";

export const maxMcpServerDisplayNameCodePoints = 256;
export const maxMcpResourceDescriptorTextCodePoints = 65_536;
export const maxMcpResourceUriCodePoints = 2_048;
export const maxMcpResourceUriBytes = 8_192;
export const maxMcpResourceItems = 32;
export const maxMcpResourceTextCodePoints = 131_072;
export const maxMcpResourceTextBytes = 524_288;
export const maxMcpResourceDescriptors = 1_000;
export const maxMcpResourceTemplateArguments = 32;

const wellFormedTextSchema = (maximumCodePoints: number) =>
  z
    .string()
    .refine(isWellFormedUnicode, "Text must contain well-formed Unicode.")
    .refine(
      (value) => [...value].length <= maximumCodePoints,
      `Text must not exceed ${maximumCodePoints} Unicode code points.`,
    );

export const mcpServerIdSchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
export const mcpServerIdentitySchema = z.strictObject({
  serverId: mcpServerIdSchema,
  displayName: wellFormedTextSchema(maxMcpServerDisplayNameCodePoints).min(1),
});
export const mcpGenerationSchema = z.number().int().positive().safe();
export const mcpResourceUriSchema = wellFormedTextSchema(maxMcpResourceUriCodePoints)
  .min(1)
  .refine(
    (value) => utf8ByteLength(value) <= maxMcpResourceUriBytes,
    `Resource URI must not exceed ${maxMcpResourceUriBytes} UTF-8 bytes.`,
  );
const descriptorTextSchema = wellFormedTextSchema(maxMcpResourceDescriptorTextCodePoints);
const mimeTypeSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/);

const resourceSourceShape = {
  server: mcpServerIdentitySchema,
  generation: mcpGenerationSchema,
};

export const mcpResourceDescriptorSchema = z.strictObject({
  ...resourceSourceShape,
  uri: mcpResourceUriSchema,
  name: descriptorTextSchema.min(1),
  title: descriptorTextSchema.optional(),
  description: descriptorTextSchema.optional(),
  mimeType: mimeTypeSchema.optional(),
});
export const mcpResourceTemplateArgumentSchema = z.strictObject({
  name: z.string().min(1).max(128),
  required: z.literal(true),
});
export const mcpResourceTemplateDescriptorSchema = z.strictObject({
  ...resourceSourceShape,
  uriTemplate: mcpResourceUriSchema,
  name: descriptorTextSchema.min(1),
  title: descriptorTextSchema.optional(),
  description: descriptorTextSchema.optional(),
  mimeType: mimeTypeSchema.optional(),
  arguments: z
    .array(mcpResourceTemplateArgumentSchema)
    .max(maxMcpResourceTemplateArguments)
    .refine(
      (values) => new Set(values.map(({ name }) => name)).size === values.length,
      "Resource Template arguments must be unique.",
    ),
});
export const mcpResourceCatalogSchema = z.strictObject({
  ...resourceSourceShape,
  resources: z.array(mcpResourceDescriptorSchema).max(maxMcpResourceDescriptors),
  templates: z.array(mcpResourceTemplateDescriptorSchema).max(maxMcpResourceDescriptors),
});
export const mcpResourceSnapshotSchema = z
  .strictObject({
    ...resourceSourceShape,
    uri: mcpResourceUriSchema,
    mimeType: mimeTypeSchema,
    items: z
      .array(z.strictObject({ text: wellFormedTextSchema(maxMcpResourceTextCodePoints) }))
      .min(1)
      .max(maxMcpResourceItems),
    truncated: z.boolean(),
  })
  .superRefine(({ items }, context) => {
    const text = items.map(({ text }) => text).join("");
    if ([...text].length > maxMcpResourceTextCodePoints) {
      context.addIssue({ code: "custom", message: "Resource text exceeds the code-point limit." });
    }
    if (utf8ByteLength(text) > maxMcpResourceTextBytes) {
      context.addIssue({ code: "custom", message: "Resource text exceeds the UTF-8 byte limit." });
    }
  });
export const mcpResourceSnapshotIdSchema = z.string().min(1).max(128);
export const mcpResourceAttachmentSchema = z.strictObject({
  snapshotId: mcpResourceSnapshotIdSchema,
  serverId: mcpServerIdSchema,
  uri: mcpResourceUriSchema,
  mimeType: mimeTypeSchema,
  text: wellFormedTextSchema(maxMcpResourceTextCodePoints).superRefine((value, context) => {
    if (utf8ByteLength(value) > maxMcpResourceTextBytes) {
      context.addIssue({
        code: "custom",
        message: "Attachment text exceeds the UTF-8 byte limit.",
      });
    }
  }),
  truncated: z.boolean(),
  provenance: mcpNegotiatedProvenanceSchema.optional(),
});

export const mcpResourceSelectionSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("resource"), uri: mcpResourceUriSchema }),
  z.strictObject({
    kind: z.literal("template"),
    uriTemplate: mcpResourceUriSchema,
    arguments: z
      .record(z.string().min(1).max(128), wellFormedTextSchema(4_096))
      .refine(
        (value) => Object.keys(value).length <= maxMcpResourceTemplateArguments,
        "Too many Resource Template arguments.",
      ),
  }),
]);

export type McpServerIdentityDto = z.infer<typeof mcpServerIdentitySchema>;
export type McpResourceDescriptorDto = z.infer<typeof mcpResourceDescriptorSchema>;
export type McpResourceTemplateDescriptorDto = z.infer<typeof mcpResourceTemplateDescriptorSchema>;
export type McpResourceCatalogDto = z.infer<typeof mcpResourceCatalogSchema>;
export type McpResourceSnapshotDto = z.infer<typeof mcpResourceSnapshotSchema>;
export type McpResourceAttachment = z.infer<typeof mcpResourceAttachmentSchema>;
export type McpResourceSelectionDto = z.infer<typeof mcpResourceSelectionSchema>;

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

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return bytes;
}
