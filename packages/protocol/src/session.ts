import { z } from "zod";

export const sessionIdSchema = z.string().min(1).max(128);

export const sessionStatusSchema = z.enum([
  "idle",
  "preparing",
  "streaming",
  "awaiting_approval",
  "executing_tool",
  "completed",
  "cancelled",
  "failed",
]);

export const sessionSummarySchema = z.strictObject({
  sessionId: sessionIdSchema,
  status: sessionStatusSchema,
  createdAt: z.iso.datetime({ offset: true }),
});

export type SessionId = z.infer<typeof sessionIdSchema>;
export type SessionStatus = z.infer<typeof sessionStatusSchema>;
export type SessionSummary = z.infer<typeof sessionSummarySchema>;
