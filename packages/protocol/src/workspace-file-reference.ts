import { z } from "zod";

import { ideTextContextSchema } from "./ide-context.js";
import { utf8ByteLength } from "./text-primitives.js";

/** The maximum number of file references that can be carried by one submission. */
export const maxWorkspaceFileReferences = 32;
export const maxWorkspaceFileSearchResults = 100;
export const maxWorkspaceFileReferenceIdCodePoints = 128;
export const maxWorkspaceFileQueryCodePoints = 256;
export const maxWorkspaceFileQueryBytes = 1_024;
export const maxWorkspaceFilePathCodePoints = 4_096;
export const maxWorkspaceFilePathBytes = 16_384;

export const workspaceFileReferenceIdSchema = z
  .string()
  .min(1)
  .max(maxWorkspaceFileReferenceIdCodePoints)
  .refine((value) => value.isWellFormed(), "Reference IDs must contain well-formed Unicode.");

export const workspaceFilePathSchema = boundedTextSchema(
  maxWorkspaceFilePathCodePoints,
  maxWorkspaceFilePathBytes,
)
  .min(1)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.includes("\\") &&
      !value.includes("?") &&
      !value.includes("#") &&
      !/%(?:2e|2f|5c)/iu.test(value) &&
      !/(?:^|\/)\.{1,2}(?:\/|$)/u.test(value),
    "Workspace file paths must be canonical workspace-relative paths.",
  );

export const workspaceFileSearchQuerySchema = boundedTextSchema(
  maxWorkspaceFileQueryCodePoints,
  maxWorkspaceFileQueryBytes,
).refine((value) => !value.includes("\0"), "Search queries must not contain NUL characters.");

export const workspaceFileReferenceSchema = z.strictObject({
  referenceId: workspaceFileReferenceIdSchema,
  context: ideTextContextSchema,
});

export const workspaceFileSearchResultSchema = z.strictObject({
  path: workspaceFilePathSchema,
});

export const workspaceFileReferenceStaleReasonSchema = z.enum([
  "changed",
  "deleted",
  "changed-during-read",
]);

export const workspaceFileReferenceClearReasonSchema = z.enum([
  "removed",
  "workspace-changed",
  "trust-lost",
]);

export const workspaceFileReferenceErrorCodeSchema = z.enum([
  "untrusted-workspace",
  "no-workspace",
  "outside-workspace",
  "binary",
  "changed-during-read",
  "unavailable",
  "limit-exceeded",
]);

const workspaceFileRequestEnvelope = {
  protocolVersion: z.literal(1),
  requestId: z.string().min(1).max(128),
};

export const workspaceFileSearchMessageSchema = z.strictObject({
  ...workspaceFileRequestEnvelope,
  type: z.literal("webview/workspace-file-search"),
  query: workspaceFileSearchQuerySchema,
});

export const workspaceFileReadMessageSchema = z.strictObject({
  ...workspaceFileRequestEnvelope,
  type: z.literal("webview/workspace-file-read"),
  path: workspaceFilePathSchema,
});

export const workspaceFileRemoveMessageSchema = z.strictObject({
  ...workspaceFileRequestEnvelope,
  type: z.literal("webview/workspace-file-remove"),
  referenceId: workspaceFileReferenceIdSchema,
});

export const workspaceFileRefreshMessageSchema = z.strictObject({
  ...workspaceFileRequestEnvelope,
  type: z.literal("webview/workspace-file-refresh"),
  referenceId: workspaceFileReferenceIdSchema,
});

export const workspaceFileUseStaleMessageSchema = z.strictObject({
  ...workspaceFileRequestEnvelope,
  type: z.literal("webview/workspace-file-use-stale"),
  referenceId: workspaceFileReferenceIdSchema,
});

export const workspaceFileSearchResponseSchema = z.discriminatedUnion("status", [
  z.strictObject({
    ...workspaceFileRequestEnvelope,
    type: z.literal("extension/workspace-file-search"),
    status: z.literal("ready"),
    results: z.array(workspaceFileSearchResultSchema).max(maxWorkspaceFileSearchResults),
    truncated: z.boolean(),
  }),
  z.strictObject({
    ...workspaceFileRequestEnvelope,
    type: z.literal("extension/workspace-file-search"),
    status: z.literal("error"),
    code: workspaceFileReferenceErrorCodeSchema,
    message: z.string().min(1).max(256),
  }),
]);

export const workspaceFileReferenceMessageSchema = z.discriminatedUnion("status", [
  z.strictObject({
    ...workspaceFileRequestEnvelope,
    type: z.literal("extension/workspace-file-reference"),
    status: z.literal("ready"),
    reference: workspaceFileReferenceSchema,
  }),
  z.strictObject({
    ...workspaceFileRequestEnvelope,
    type: z.literal("extension/workspace-file-reference"),
    status: z.literal("stale"),
    reference: workspaceFileReferenceSchema.refine(
      (value) => value.context.source.stale,
      "Stale workspace file references must mark their source stale.",
    ),
    reason: workspaceFileReferenceStaleReasonSchema,
  }),
  z.strictObject({
    ...workspaceFileRequestEnvelope,
    type: z.literal("extension/workspace-file-reference"),
    status: z.literal("removed"),
    referenceId: workspaceFileReferenceIdSchema,
    reason: workspaceFileReferenceClearReasonSchema,
  }),
  z.strictObject({
    ...workspaceFileRequestEnvelope,
    type: z.literal("extension/workspace-file-reference"),
    status: z.literal("error"),
    referenceId: workspaceFileReferenceIdSchema.optional(),
    code: workspaceFileReferenceErrorCodeSchema,
    message: z.string().min(1).max(256),
  }),
]);

export type WorkspaceFileReference = z.infer<typeof workspaceFileReferenceSchema>;
export type WorkspaceFileSearchResult = z.infer<typeof workspaceFileSearchResultSchema>;
export type WorkspaceFileReferenceStaleReason = z.infer<
  typeof workspaceFileReferenceStaleReasonSchema
>;
export type WorkspaceFileReferenceClearReason = z.infer<
  typeof workspaceFileReferenceClearReasonSchema
>;
export type WorkspaceFileReferenceErrorCode = z.infer<typeof workspaceFileReferenceErrorCodeSchema>;
export type WorkspaceFileSearchMessage = z.infer<typeof workspaceFileSearchMessageSchema>;
export type WorkspaceFileReadMessage = z.infer<typeof workspaceFileReadMessageSchema>;
export type WorkspaceFileRemoveMessage = z.infer<typeof workspaceFileRemoveMessageSchema>;
export type WorkspaceFileRefreshMessage = z.infer<typeof workspaceFileRefreshMessageSchema>;
export type WorkspaceFileUseStaleMessage = z.infer<typeof workspaceFileUseStaleMessageSchema>;
export type WorkspaceFileSearchResponse = z.infer<typeof workspaceFileSearchResponseSchema>;
export type WorkspaceFileReferenceMessage = z.infer<typeof workspaceFileReferenceMessageSchema>;

function boundedTextSchema(maxCodePoints: number, maxBytes: number) {
  return z
    .string()
    .refine((value) => value.isWellFormed(), "Text must contain well-formed Unicode.")
    .refine(
      (value) => [...value].length <= maxCodePoints,
      `Text must not exceed ${maxCodePoints} Unicode code points.`,
    )
    .refine(
      (value) => utf8ByteLength(value) <= maxBytes,
      `Text must not exceed ${maxBytes} UTF-8 bytes.`,
    );
}
