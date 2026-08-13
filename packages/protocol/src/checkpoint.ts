import { z } from "zod";

import { maxApprovalUriCharacters } from "./approval.js";
import { type CheckpointRunId, checkpointRunIdSchema } from "./run-id.js";
import { sessionIdSchema } from "./session.js";

export type { CheckpointRunId } from "./run-id.js";
export {
  checkpointRunIdSchema,
  maxCheckpointRunIdCharacters,
} from "./run-id.js";

export const maxCheckpointIdCharacters = 128;
export const maxCheckpointFiles = 128;

export const checkpointIdSchema = z.string().min(1).max(maxCheckpointIdCharacters);
export const checkpointHashSchema = z.string().regex(/^[a-f0-9]{64}$/);

const legacyCheckpointFileSchema = z.strictObject({
  uri: z.string().min(1).max(maxApprovalUriCharacters),
  beforeContent: z.string(),
  beforeHash: checkpointHashSchema,
  afterHash: checkpointHashSchema,
});

export const checkpointBeforeStateSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("absent") }),
  z.strictObject({
    kind: z.literal("text"),
    content: z.string(),
    beforeHash: checkpointHashSchema,
  }),
]);

export const checkpointAfterStateSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("absent") }),
  z.strictObject({ kind: z.literal("text"), afterHash: checkpointHashSchema }),
]);

const lifecycleCheckpointFileSchema = z.strictObject({
  uri: z.string().min(1).max(maxApprovalUriCharacters),
  before: checkpointBeforeStateSchema,
  after: checkpointAfterStateSchema,
});

export const checkpointFileSchema = z.union([
  legacyCheckpointFileSchema,
  lifecycleCheckpointFileSchema,
]);

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

const legacyCheckpointSummaryFileSchema = z.strictObject({
  uri: z.string().min(1).max(maxApprovalUriCharacters),
  beforeHash: checkpointHashSchema,
  afterHash: checkpointHashSchema,
});

const lifecycleCheckpointSummaryFileSchema = z.strictObject({
  uri: z.string().min(1).max(maxApprovalUriCharacters),
  before: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("absent") }),
    z.strictObject({ kind: z.literal("text"), beforeHash: checkpointHashSchema }),
  ]),
  after: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("absent") }),
    z.strictObject({ kind: z.literal("text"), afterHash: checkpointHashSchema }),
  ]),
});

export const checkpointSummaryFileSchema = z.union([
  legacyCheckpointSummaryFileSchema,
  lifecycleCheckpointSummaryFileSchema,
]);

export const checkpointSummarySchema = z.strictObject({
  id: checkpointIdSchema,
  sessionId: sessionIdSchema,
  runId: checkpointRunIdSchema,
  createdAt: z.iso.datetime({ offset: true }),
  files: z.array(checkpointSummaryFileSchema).nonempty().max(maxCheckpointFiles),
});

export type CheckpointId = z.infer<typeof checkpointIdSchema>;
export type CheckpointHash = z.infer<typeof checkpointHashSchema>;
export type CheckpointBeforeState = z.infer<typeof checkpointBeforeStateSchema>;
export type CheckpointAfterState = z.infer<typeof checkpointAfterStateSchema>;
export type CheckpointFile = {
  readonly uri: string;
  readonly beforeContent?: string;
  readonly beforeHash?: CheckpointHash;
  readonly afterHash?: CheckpointHash;
  readonly before?: CheckpointBeforeState;
  readonly after?: CheckpointAfterState;
};
export type Checkpoint = {
  readonly id: CheckpointId;
  readonly sessionId: z.infer<typeof sessionIdSchema>;
  readonly runId: CheckpointRunId;
  readonly createdAt: string;
  readonly files: readonly CheckpointFile[];
};
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
  const checkpoint = checkpointSchema.parse(value) as Checkpoint;

  for (const file of checkpoint.files) {
    const beforeHash =
      file.beforeContent !== undefined && file.beforeHash !== undefined
        ? file.beforeHash
        : file.before?.kind === "text"
          ? file.before.beforeHash
          : undefined;
    const beforeContent =
      file.beforeContent !== undefined
        ? file.beforeContent
        : file.before?.kind === "text"
          ? file.before.content
          : undefined;
    if (beforeContent !== undefined && hashText(beforeContent) !== beforeHash) {
      throw new InvalidCheckpointIntegrityError();
    }
  }

  return checkpoint;
}
