import { z } from "zod";

import { utf8ByteLength } from "./text-primitives.js";

export const maxCommandDisplayOutputBytes = 262_144;

const commandStreamSchema = z.string().max(maxCommandDisplayOutputBytes);
const commandSignalSchema = z
  .string()
  .min(1)
  .max(32)
  .regex(/^[A-Z][A-Z0-9]*$/);

export const runCommandOutputSchema = z
  .strictObject({
    stdout: commandStreamSchema,
    stderr: commandStreamSchema,
    exitCode: z.int().min(0).max(0xffff_ffff).nullable(),
    signal: commandSignalSchema.nullable(),
  })
  .superRefine((output, context) => {
    const outputBytes = utf8ByteLength(output.stdout) + utf8ByteLength(output.stderr);
    if (outputBytes > maxCommandDisplayOutputBytes) {
      context.addIssue({
        code: "custom",
        message: `Command display output exceeds the ${maxCommandDisplayOutputBytes}-byte limit.`,
      });
    }
  });

export type RunCommandOutput = z.infer<typeof runCommandOutputSchema>;
