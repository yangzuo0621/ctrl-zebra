import { describe, expect, it } from "vitest";

import {
  InvalidTextEditPlanError,
  OverlappingTextEditsError,
  parseTextEditPlan,
} from "./text-edit.js";

const validPlan = {
  uri: "file:///workspace/example.ts",
  originalRevision: { kind: "document_version", value: 7 },
  edits: [
    {
      range: {
        start: { line: 2, character: 0 },
        end: { line: 2, character: 3 },
      },
      newText: "two",
    },
    {
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 3 },
      },
      newText: "one",
    },
  ],
} as const;

describe("Text Edit Plan", () => {
  it("parses, orders, and round-trips a document-version plan through JSON", () => {
    const plan = parseTextEditPlan(validPlan);

    expect(plan.edits.map((edit) => edit.newText)).toEqual(["one", "two"]);
    expect(parseTextEditPlan(JSON.parse(JSON.stringify(plan)) as unknown)).toEqual(plan);
  });

  it("accepts a SHA-256 content revision", () => {
    expect(
      parseTextEditPlan({
        ...validPlan,
        originalRevision: {
          kind: "content_hash",
          algorithm: "sha256",
          value: "a".repeat(64),
        },
      }).originalRevision,
    ).toEqual({ kind: "content_hash", algorithm: "sha256", value: "a".repeat(64) });
  });

  it("allows adjacent half-open ranges", () => {
    expect(() =>
      parseTextEditPlan({
        ...validPlan,
        edits: [
          {
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 2 } },
            newText: "first",
          },
          {
            range: { start: { line: 0, character: 2 }, end: { line: 0, character: 4 } },
            newText: "second",
          },
        ],
      }),
    ).not.toThrow();
  });

  it.each([
    { line: -1, character: 0 },
    { line: 0, character: -1 },
    { line: 0.5, character: 0 },
    { line: Number.MAX_SAFE_INTEGER + 1, character: 0 },
  ])("rejects an invalid position %#", (start) => {
    expect(() =>
      parseTextEditPlan({
        ...validPlan,
        edits: [
          {
            range: { start, end: { line: 1, character: 0 } },
            newText: "replacement",
          },
        ],
      }),
    ).toThrow(InvalidTextEditPlanError);
  });

  it("rejects a range whose end precedes its start", () => {
    expect(() =>
      parseTextEditPlan({
        ...validPlan,
        edits: [
          {
            range: {
              start: { line: 1, character: 0 },
              end: { line: 0, character: 4 },
            },
            newText: "replacement",
          },
        ],
      }),
    ).toThrow(InvalidTextEditPlanError);
  });

  it("rejects overlapping ranges", () => {
    expect(() =>
      parseTextEditPlan({
        ...validPlan,
        edits: [
          {
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } },
            newText: "first",
          },
          {
            range: { start: { line: 0, character: 3 }, end: { line: 0, character: 5 } },
            newText: "second",
          },
        ],
      }),
    ).toThrow(OverlappingTextEditsError);
  });

  it("rejects multiple edits with the same start position", () => {
    expect(() =>
      parseTextEditPlan({
        ...validPlan,
        edits: [
          {
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
            newText: "insert",
          },
          {
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
            newText: "replace",
          },
        ],
      }),
    ).toThrow(OverlappingTextEditsError);
  });

  it("rejects missing or additional fields", () => {
    expect(() => parseTextEditPlan({ ...validPlan, unexpected: true })).toThrow(
      InvalidTextEditPlanError,
    );
    expect(() => parseTextEditPlan({ uri: validPlan.uri, edits: validPlan.edits })).toThrow(
      InvalidTextEditPlanError,
    );
  });
});
