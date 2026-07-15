import { z } from "zod";

import { sessionIdSchema } from "./session.js";

export const messageIdSchema = z.string().min(1).max(128);

const persistedMessageShape = {
  messageId: messageIdSchema,
  sessionId: sessionIdSchema,
  createdAt: z.iso.datetime({ offset: true }),
  content: z.string().min(1).max(1_000_000),
};

export const userMessageSchema = z.strictObject({
  ...persistedMessageShape,
  role: z.literal("user"),
});

export const assistantMessageSchema = z.strictObject({
  ...persistedMessageShape,
  role: z.literal("assistant"),
});

export const toolMessageSchema = z.strictObject({
  ...persistedMessageShape,
  role: z.literal("tool"),
});

export const chatMessageSchema = z.discriminatedUnion("role", [
  userMessageSchema,
  assistantMessageSchema,
  toolMessageSchema,
]);

export type MessageId = z.infer<typeof messageIdSchema>;
export type UserMessage = z.infer<typeof userMessageSchema>;
export type AssistantMessage = z.infer<typeof assistantMessageSchema>;
export type ToolMessage = z.infer<typeof toolMessageSchema>;
export type ChatMessage = z.infer<typeof chatMessageSchema>;
