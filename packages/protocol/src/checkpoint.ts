import { z } from "zod";

import { maxApprovalUriCharacters } from "./approval.js";
import { sessionIdSchema } from "./session.js";

export const maxCheckpointIdCharacters = 128;
export const maxCheckpointRunIdCharacters = 128;
export const maxCheckpointFiles = 128;

export const checkpointIdSchema = z.string().min(1).max(maxCheckpointIdCharacters);
export const checkpointRunIdSchema = z.string().min(1).max(maxCheckpointRunIdCharacters);
export const checkpointHashSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const checkpointFileSchema = z.strictObject({
  uri: z.string().min(1).max(maxApprovalUriCharacters),
  beforeContent: z.string(),
  beforeHash: checkpointHashSchema,
  afterHash: checkpointHashSchema,
});

export const checkpointSchema = z
  .strictObject({
    id: checkpointIdSchema,
    sessionId: sessionIdSchema,
    runId: checkpointRunIdSchema,
    createdAt: z.iso.datetime({ offset: true }),
    files: z.array(checkpointFileSchema).nonempty().max(maxCheckpointFiles),
  })
  .superRefine((checkpoint, context) => {
    const seenUris = new Set<string>();

    checkpoint.files.forEach((file, index) => {
      if (seenUris.has(file.uri)) {
        context.addIssue({
          code: "custom",
          path: ["files", index, "uri"],
          message: "Checkpoint file targets must be distinct.",
        });
      }
      seenUris.add(file.uri);
    });
  });

export const checkpointSummaryFileSchema = z.strictObject({
  uri: z.string().min(1).max(maxApprovalUriCharacters),
  beforeHash: checkpointHashSchema,
  afterHash: checkpointHashSchema,
});

export const checkpointSummarySchema = z.strictObject({
  id: checkpointIdSchema,
  sessionId: sessionIdSchema,
  runId: checkpointRunIdSchema,
  createdAt: z.iso.datetime({ offset: true }),
  files: z.array(checkpointSummaryFileSchema).nonempty().max(maxCheckpointFiles),
});

export type CheckpointId = z.infer<typeof checkpointIdSchema>;
export type CheckpointRunId = z.infer<typeof checkpointRunIdSchema>;
export type CheckpointHash = z.infer<typeof checkpointHashSchema>;
export type CheckpointFile = z.infer<typeof checkpointFileSchema>;
export type Checkpoint = z.infer<typeof checkpointSchema>;
export type CheckpointSummaryFile = z.infer<typeof checkpointSummaryFileSchema>;
export type CheckpointSummary = z.infer<typeof checkpointSummarySchema>;

export type CheckpointTextHasher = (text: string) => string;

export class InvalidCheckpointIntegrityError extends Error {
  constructor() {
    super("Checkpoint before-content does not match its recorded hash.");
    this.name = "InvalidCheckpointIntegrityError";
  }
}

export function parseCheckpoint(value: unknown, hashText: CheckpointTextHasher): Checkpoint {
  const checkpoint = checkpointSchema.parse(value);

  for (const file of checkpoint.files) {
    if (hashText(file.beforeContent) !== file.beforeHash) {
      throw new InvalidCheckpointIntegrityError();
    }
  }

  return checkpoint;
}
