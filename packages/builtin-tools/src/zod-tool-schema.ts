import type { ToolInputSchema } from "@ctrl-zebra/core";
import { z } from "zod";

/**
 * Derives the JSON Schema advertised to the model from a zod object schema, instead of hand
 * writing a parallel literal that can silently drift from what the schema's own parser actually
 * accepts. `z.toJSONSchema()`'s `$schema` version marker is stripped since `ToolInputSchema`
 * doesn't carry one; for a plain, closed object schema (no `$ref`, no `anyOf`/`oneOf`, no
 * cross-field `.refine()` -- refinements are parse-time-only and never appear in the JSON Schema
 * output) the remaining shape matches `ToolInputSchema` field-for-field. Verified per tool by a
 * dedicated test comparing the generated schema against the hand-written literal it replaces,
 * before that literal is deleted.
 *
 * `ToolInputSchema.required` is mandatory, but `z.toJSONSchema()` omits the `required` key
 * entirely for an object schema with zero required properties -- defaulted to `[]` here so every
 * caller (e.g. providers/src/ai-sdk-model-gateway.ts's `[...schema.required]`) can keep treating
 * it as always present, instead of every future consumer needing its own `?? []` guard.
 */
export function toToolInputSchema(schema: z.ZodType): ToolInputSchema {
  const { $schema: _schema, required = [], ...jsonSchema } = z.toJSONSchema(schema);
  return { ...jsonSchema, required } as ToolInputSchema;
}
