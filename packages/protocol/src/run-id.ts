import { z } from "zod";

export const maxCheckpointRunIdCharacters = 128;

export const checkpointRunIdSchema = z.string().min(1).max(maxCheckpointRunIdCharacters);

export type CheckpointRunId = z.infer<typeof checkpointRunIdSchema>;
