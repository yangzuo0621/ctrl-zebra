import { describe, expect, it } from "vitest";

import {
  InvalidWorkspaceEditPlanError,
  maxWorkspaceEditAggregateReplacementBytes,
  maxWorkspaceEditFiles,
  OverlappingWorkspaceEditError,
  parseWorkspaceEditPlan,
} from "./workspace-edit.js";

const revision = { kind: "document_version", value: 3 } as const;

function target(path: string, value = 0) {
  return {
    path,
    uri: `file:///workspace/${path}`,
    originalRevision: { kind: "document_version", value },
    edits: [
      {
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
        newText: "zebra",
      },
    ],
  };
}

describe("parseWorkspaceEditPlan", () => {
  it("normalizes targets by path while preserving each revision and edits", () => {
    expect(
      parseWorkspaceEditPlan({ operation: "edit", files: [target("b.ts"), target("a.ts")] }),
    ).toEqual({
      operation: "edit",
      files: [target("a.ts"), target("b.ts")],
    });
  });

  it.each([
    { operation: "edit", files: [target("a.ts")] },
    {
      operation: "edit",
      files: Array.from({ length: maxWorkspaceEditFiles + 1 }, (_, index) =>
        target(`file-${index}.ts`),
      ),
    },
    { operation: "edit", files: [target("a.ts"), target("a.ts")] },
    { operation: "edit", files: [target("a.ts"), { ...target("b.ts"), uri: target("a.ts").uri }] },
    { operation: "edit", files: [target("../outside.ts"), target("b.ts")] },
    { operation: "other", files: [target("a.ts"), target("b.ts")] },
    { operation: "edit", files: [target("a.ts"), { ...target("b.ts"), unexpected: true }] },
  ])("rejects invalid plan %#", (candidate) => {
    expect(() => parseWorkspaceEditPlan(candidate)).toThrow(InvalidWorkspaceEditPlanError);
  });

  it("rejects overlapping edits inside one target", () => {
    const file = target("a.ts");
    file.edits = [
      {
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 2 } },
        newText: "a",
      },
      {
        range: { start: { line: 0, character: 1 }, end: { line: 0, character: 3 } },
        newText: "b",
      },
    ];
    expect(() =>
      parseWorkspaceEditPlan({ operation: "edit", files: [file, target("b.ts")] }),
    ).toThrow(OverlappingWorkspaceEditError);
  });

  it("reports malformed edits as invalid rather than overlapping", () => {
    const file = target("a.ts");
    file.edits = [
      {
        range: { start: { line: 0, character: 1 }, end: { line: 0, character: 0 } },
        newText: "a",
      },
    ];
    expect(() =>
      parseWorkspaceEditPlan({ operation: "edit", files: [file, target("b.ts")] }),
    ).toThrow(InvalidWorkspaceEditPlanError);
  });

  it("rejects replacement aggregate overflow before retaining a plan", () => {
    const file = target("a.ts");
    file.edits = [
      {
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
        newText: "x".repeat(maxWorkspaceEditAggregateReplacementBytes),
      },
    ];
    expect(() =>
      parseWorkspaceEditPlan({ operation: "edit", files: [file, target("b.ts")] }),
    ).toThrow(InvalidWorkspaceEditPlanError);
  });

  it("accepts content-hash revisions", () => {
    expect(
      parseWorkspaceEditPlan({
        operation: "edit",
        files: [
          {
            ...target("a.ts"),
            originalRevision: { kind: "content_hash", algorithm: "sha256", value: "a".repeat(64) },
          },
          { ...target("b.ts"), originalRevision: revision },
        ],
      }).files[0]?.originalRevision,
    ).toEqual({ kind: "content_hash", algorithm: "sha256", value: "a".repeat(64) });
  });
});
