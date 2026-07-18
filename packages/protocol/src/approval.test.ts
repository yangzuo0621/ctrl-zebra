import { describe, expect, it } from "vitest";

import {
  type ApprovalRequest,
  approvalDecisionSchema,
  approvalRequestIdSchema,
  approvalRequestSchema,
  approvalStatusSchema,
  maxApprovalPresentationSummaryCharacters,
  maxApprovalPresentationTitleCharacters,
  maxApprovalResources,
  maxApprovalUriCharacters,
} from "./index.js";

const validRequest = {
  id: "approval-1",
  scope: {
    sessionId: "session-1",
    call: {
      id: "call-1",
      name: "propose_file_edit",
      input: { uri: "file:///workspace/example.txt", replacement: "updated" },
    },
    risk: "write",
    workspaceRootUri: "file:///workspace",
    resources: [
      {
        uri: "file:///workspace/example.txt",
        revision: { kind: "content_hash", algorithm: "sha256", value: "a".repeat(64) },
      },
    ],
  },
  presentation: {
    title: "Update example.txt",
    summary: "Replace the selected text in example.txt.",
  },
  createdAt: "2026-07-19T10:00:00+08:00",
  expiresAt: "2026-07-19T10:05:00+08:00",
} satisfies ApprovalRequest;

describe("Approval DTO", () => {
  it("round-trips an exact Approval Request through JSON", () => {
    expect(
      approvalRequestSchema.parse(JSON.parse(JSON.stringify(validRequest)) as unknown),
    ).toEqual(validRequest);
  });

  it.each([
    { ...validRequest, id: "" },
    { ...validRequest, id: "x".repeat(129) },
    { ...validRequest, unexpected: true },
    { ...validRequest, createdAt: "2026-07-19T10:00:00" },
    { ...validRequest, expiresAt: validRequest.createdAt },
    { ...validRequest, expiresAt: "2026-07-19T01:59:59Z" },
    { ...validRequest, presentation: { ...validRequest.presentation, title: "" } },
    {
      ...validRequest,
      presentation: {
        ...validRequest.presentation,
        title: "x".repeat(maxApprovalPresentationTitleCharacters + 1),
      },
    },
    {
      ...validRequest,
      presentation: {
        ...validRequest.presentation,
        summary: "x".repeat(maxApprovalPresentationSummaryCharacters + 1),
      },
    },
    { ...validRequest, scope: { ...validRequest.scope, risk: "unknown" } },
    { ...validRequest, scope: { ...validRequest.scope, unexpected: true } },
    {
      ...validRequest,
      scope: { ...validRequest.scope, workspaceRootUri: "x".repeat(maxApprovalUriCharacters + 1) },
    },
    {
      ...validRequest,
      scope: {
        ...validRequest.scope,
        resources: Array.from({ length: maxApprovalResources + 1 }, () => ({ uri: "file:///x" })),
      },
    },
    {
      ...validRequest,
      scope: {
        ...validRequest.scope,
        resources: [{ uri: "file:///x", revision: { kind: "document_version", value: -1 } }],
      },
    },
    {
      ...validRequest,
      scope: {
        ...validRequest.scope,
        resources: [
          {
            uri: "file:///x",
            revision: { kind: "content_hash", algorithm: "sha256", value: "not-a-hash" },
          },
        ],
      },
    },
    {
      ...validRequest,
      scope: { ...validRequest.scope, call: { ...validRequest.scope.call, input: undefined } },
    },
  ])("rejects an invalid Approval Request %#", (request) => {
    expect(approvalRequestSchema.safeParse(request).success).toBe(false);
  });

  it.each(["approved", "denied"] as const)("accepts the %s decision", (decision) => {
    expect(
      approvalDecisionSchema.parse({
        requestId: validRequest.id,
        decision,
        decidedAt: "2026-07-19T02:01:00Z",
      }),
    ).toEqual({
      requestId: validRequest.id,
      decision,
      decidedAt: "2026-07-19T02:01:00Z",
    });
  });

  it.each([
    { requestId: validRequest.id, decision: "allow", decidedAt: "2026-07-19T02:01:00Z" },
    { requestId: validRequest.id, decision: "approved", decidedAt: "not-a-date" },
    {
      requestId: validRequest.id,
      decision: "denied",
      decidedAt: "2026-07-19T02:01:00Z",
      unexpected: true,
    },
  ])("rejects an invalid Approval Decision %#", (decision) => {
    expect(approvalDecisionSchema.safeParse(decision).success).toBe(false);
  });

  it("accepts every Approval status", () => {
    expect(
      ["pending", "approved", "denied", "cancelled", "expired", "invalidated", "consumed"].map(
        (status) => approvalStatusSchema.parse(status),
      ),
    ).toHaveLength(7);
  });

  it("validates Approval Request identifiers independently", () => {
    expect(approvalRequestIdSchema.parse(validRequest.id)).toBe(validRequest.id);
    expect(approvalRequestIdSchema.safeParse(42).success).toBe(false);
  });
});
