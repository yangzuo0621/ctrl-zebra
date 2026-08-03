import { z } from "zod";

import { mcpGenerationSchema, mcpServerIdentitySchema, mcpServerIdSchema } from "./mcp-resource.js";

export const maxMcpPromptDescriptors = 1_000;
export const maxMcpPromptArguments = 32;
export const maxMcpPromptArgumentNameCodePoints = 64;
export const maxMcpPromptArgumentValueCodePoints = 4_096;
export const maxMcpPromptArgumentsBytes = 65_536;
export const maxMcpPromptMessages = 32;
export const maxMcpPromptTextCodePoints = 65_536;
export const maxMcpPromptTextBytes = 262_144;
export const maxMcpPromptProjectedTextCodePoints = 262_144;
export const maxMcpPromptProjectedTextBytes = 524_288;

const textSchema = (maximumCodePoints: number) =>
  z
    .string()
    .refine(isWellFormedUnicode, "Text must contain well-formed Unicode.")
    .refine((value) => [...value].length <= maximumCodePoints);
const descriptorTextSchema = textSchema(65_536);
export const mcpPromptNameSchema = descriptorTextSchema.min(1);
export const mcpPromptArgumentNameSchema = textSchema(maxMcpPromptArgumentNameCodePoints).min(1);
export const mcpPromptArgumentsSchema = z
  .record(mcpPromptArgumentNameSchema, textSchema(maxMcpPromptArgumentValueCodePoints))
  .superRefine((value, context) => {
    if (Object.keys(value).length > maxMcpPromptArguments) {
      context.addIssue({ code: "custom", message: "Too many Prompt arguments." });
    }
    if (utf8ByteLength(JSON.stringify(value)) > maxMcpPromptArgumentsBytes) {
      context.addIssue({ code: "custom", message: "Prompt arguments exceed the byte limit." });
    }
  });

export const mcpPromptArgumentDescriptorSchema = z.strictObject({
  name: mcpPromptArgumentNameSchema,
  description: descriptorTextSchema.optional(),
  required: z.boolean(),
});
export const mcpPromptDescriptorSchema = z.strictObject({
  server: mcpServerIdentitySchema,
  generation: mcpGenerationSchema,
  name: mcpPromptNameSchema,
  title: descriptorTextSchema.optional(),
  description: descriptorTextSchema.optional(),
  arguments: z
    .array(mcpPromptArgumentDescriptorSchema)
    .max(maxMcpPromptArguments)
    .refine(
      (values) => new Set(values.map(({ name }) => name)).size === values.length,
      "Prompt arguments must be unique.",
    ),
});
export const mcpPromptCatalogSchema = z.strictObject({
  server: mcpServerIdentitySchema,
  generation: mcpGenerationSchema,
  prompts: z.array(mcpPromptDescriptorSchema).max(maxMcpPromptDescriptors),
});
export const mcpPromptMessageSchema = z.strictObject({
  sourceRole: z.enum(["user", "assistant"]),
  text: textSchema(maxMcpPromptTextCodePoints),
});
export const mcpPromptPreviewIdSchema = z.string().min(1).max(128);
export const mcpPromptPreviewSchema = z
  .strictObject({
    previewId: mcpPromptPreviewIdSchema,
    server: mcpServerIdentitySchema,
    generation: mcpGenerationSchema,
    promptName: mcpPromptNameSchema,
    arguments: mcpPromptArgumentsSchema,
    messages: z.array(mcpPromptMessageSchema).min(1).max(maxMcpPromptMessages),
  })
  .superRefine(({ messages }, context) => {
    const text = messages.map((message) => message.text).join("");
    if ([...text].length > maxMcpPromptTextCodePoints) {
      context.addIssue({ code: "custom", message: "Prompt text exceeds the code-point limit." });
    }
    if (utf8ByteLength(text) > maxMcpPromptTextBytes) {
      context.addIssue({ code: "custom", message: "Prompt text exceeds the byte limit." });
    }
  });
export const mcpPromptConfirmationSchema = z.strictObject({
  serverId: mcpServerIdSchema,
  promptName: mcpPromptNameSchema,
  projectedText: textSchema(maxMcpPromptProjectedTextCodePoints).superRefine((value, context) => {
    if (utf8ByteLength(value) > maxMcpPromptProjectedTextBytes) {
      context.addIssue({
        code: "custom",
        message: "Projected Prompt text exceeds the byte limit.",
      });
    }
  }),
});

export type McpPromptArgumentsDto = z.infer<typeof mcpPromptArgumentsSchema>;
export type McpPromptDescriptorDto = z.infer<typeof mcpPromptDescriptorSchema>;
export type McpPromptCatalogDto = z.infer<typeof mcpPromptCatalogSchema>;
export type McpPromptPreviewDto = z.infer<typeof mcpPromptPreviewSchema>;
export type McpPromptConfirmation = z.infer<typeof mcpPromptConfirmationSchema>;

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
