import { z } from "zod";

import { sessionIdSchema } from "./session.js";
import { toolCallSchema, toolRiskSchema } from "./tool.js";

export const maxApprovalPresentationTitleCharacters = 256;
export const maxApprovalPresentationSummaryCharacters = 4_096;
export const maxApprovalUriCharacters = 4_096;
export const maxApprovalResources = 128;

export const approvalRequestIdSchema = z.string().min(1).max(128);

export const approvalResourceRevisionSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("document_version"),
    value: z.number().int().nonnegative(),
  }),
  z.strictObject({
    kind: z.literal("content_hash"),
    algorithm: z.literal("sha256"),
    value: z.string().regex(/^[a-f0-9]{64}$/),
  }),
]);

export const approvalResourceSchema = z.strictObject({
  uri: z.string().min(1).max(maxApprovalUriCharacters),
  revision: approvalResourceRevisionSchema.optional(),
});

export const approvalScopeSchema = z.strictObject({
  sessionId: sessionIdSchema,
  call: toolCallSchema,
  risk: toolRiskSchema,
  workspaceRootUri: z.string().min(1).max(maxApprovalUriCharacters).optional(),
  resources: z.array(approvalResourceSchema).max(maxApprovalResources),
});

export const approvalPresentationSchema = z.strictObject({
  title: z.string().min(1).max(maxApprovalPresentationTitleCharacters),
  summary: z.string().min(1).max(maxApprovalPresentationSummaryCharacters),
});

const approvalTimestampSchema = z.iso.datetime({ offset: true });

export const approvalRequestSchema = z
  .strictObject({
    id: approvalRequestIdSchema,
    scope: approvalScopeSchema,
    presentation: approvalPresentationSchema,
    createdAt: approvalTimestampSchema,
    expiresAt: approvalTimestampSchema,
  })
  .superRefine((request, context) => {
    if (Date.parse(request.expiresAt) <= Date.parse(request.createdAt)) {
      context.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "Approval expiration must be later than creation.",
      });
    }
  });

const approvedDecisionSchema = z.strictObject({
  requestId: approvalRequestIdSchema,
  decision: z.literal("approved"),
  decidedAt: approvalTimestampSchema,
});

const deniedDecisionSchema = z.strictObject({
  requestId: approvalRequestIdSchema,
  decision: z.literal("denied"),
  decidedAt: approvalTimestampSchema,
});

export const approvalDecisionSchema = z.discriminatedUnion("decision", [
  approvedDecisionSchema,
  deniedDecisionSchema,
]);

export const approvalStatusSchema = z.enum([
  "pending",
  "approved",
  "denied",
  "cancelled",
  "expired",
  "invalidated",
  "consumed",
]);

export type ApprovalRequestId = z.infer<typeof approvalRequestIdSchema>;
export type ApprovalResourceRevision = z.infer<typeof approvalResourceRevisionSchema>;
export type ApprovalResource = z.infer<typeof approvalResourceSchema>;
export type ApprovalScope = z.infer<typeof approvalScopeSchema>;
export type ApprovalPresentation = z.infer<typeof approvalPresentationSchema>;
export type ApprovalRequest = z.infer<typeof approvalRequestSchema>;
export type ApprovalDecision = z.infer<typeof approvalDecisionSchema>;
export type ApprovalStatus = z.infer<typeof approvalStatusSchema>;
