import { z } from "zod";

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

function utf8ByteLength(value: string): number {
  let length = 0;

  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined || codePoint <= 0x7f) {
      length += 1;
    } else if (codePoint <= 0x7ff) {
      length += 2;
    } else if (codePoint <= 0xffff) {
      length += 3;
    } else {
      length += 4;
    }
  }

  return length;
}
