import { describe, expect, it } from "vitest";

import {
  ideEditorContextResultSchema,
  ideTextContextSchema,
  maxIdeTextBytes,
  maxIdeTextCodePoints,
  maxIdeTextLines,
  takeIdeTextPrefix,
} from "./index.js";

describe("IDE context protocol", () => {
  it("keeps a complete text value at every exact boundary", () => {
    const atCodePointLimit = "a".repeat(maxIdeTextCodePoints);
    const atByteLimit = "😀".repeat(maxIdeTextBytes / 4);
    const atLineLimit = Array.from({ length: maxIdeTextLines }, () => "line").join("\n");

    expect(takeIdeTextPrefix(atCodePointLimit)).toEqual({
      text: atCodePointLimit,
      truncated: false,
      truncationReasons: [],
    });
    expect(takeIdeTextPrefix(atByteLimit)).toEqual({
      text: atByteLimit,
      truncated: false,
      truncationReasons: [],
    });
    expect(takeIdeTextPrefix(atLineLimit)).toEqual({
      text: atLineLimit,
      truncated: false,
      truncationReasons: [],
    });
  });

  it.each([
    { delimiter: "\n", label: "LF" },
    { delimiter: "\r\n", label: "CRLF" },
  ])("stops before the delimiter that would create line 2,001 (%s)", ({ delimiter }) => {
    const source = Array.from({ length: maxIdeTextLines + 1 }, () => "line").join(delimiter);
    const projection = takeIdeTextPrefix(source);

    expect(projection.truncated).toBe(true);
    expect(projection.truncationReasons).toEqual(["lines"]);
    expect(projection.text.split(/\r\n|\n/u)).toHaveLength(maxIdeTextLines);
    expect(projection.text.endsWith("\r")).toBe(false);
  });

  it("treats a terminal newline as the following empty line", () => {
    const source = `${Array.from({ length: maxIdeTextLines - 1 }, () => "line").join("\n")}\n`;
    const projection = takeIdeTextPrefix(source);

    expect(projection.truncated).toBe(false);
    expect(projection.text.split("\n")).toHaveLength(maxIdeTextLines);
  });

  it("keeps CRLF atomic when a byte or scalar limit is reached", () => {
    const source = `${"a".repeat(maxIdeTextCodePoints - 1)}\r\nrest`;
    const projection = takeIdeTextPrefix(source);

    expect(projection.truncated).toBe(true);
    expect(projection.truncationReasons).toEqual(["code-points"]);
    expect(projection.text.endsWith("\r")).toBe(false);
  });

  it("rejects malformed Unicode before it can cross the protocol boundary", () => {
    expect(() => takeIdeTextPrefix("ok\ud800" as string)).toThrow(
      "IDE text must contain well-formed Unicode.",
    );
  });

  it("validates strict editor result DTOs and truncation metadata", () => {
    const result = {
      kind: "editor-context",
      context: {
        source: {
          uri: { scheme: "file", authority: "", path: "src/index.ts" },
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 1 },
          },
          languageId: "typescript",
          documentVersion: 1,
          stale: false,
          truncated: true,
          truncationReasons: ["code-points"],
        },
        text: "a",
      },
    } as const;

    expect(ideEditorContextResultSchema.parse(result)).toEqual(result);
    expect(
      ideTextContextSchema.safeParse({
        ...result.context,
        source: { ...result.context.source, truncated: false },
      }).success,
    ).toBe(false);
    expect(
      ideEditorContextResultSchema.safeParse({
        ...result,
        extra: true,
      }).success,
    ).toBe(false);
  });
});
