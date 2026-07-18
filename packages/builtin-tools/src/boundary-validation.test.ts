import { describe, expect, it } from "vitest";

import {
  decodeBoundedUtf8Prefix,
  isSafeForwardSlashPath,
  parseBoundedBytes,
  parseWorkspaceFilePaths,
} from "./boundary-validation.js";

const encoder = new TextEncoder();

describe("boundary validation", () => {
  it("applies the configured forward-slash path policy", () => {
    expect(
      isSafeForwardSlashPath("/src/**/*.ts", {
        maxLength: 256,
        allowLeadingSlash: true,
        rejectCurrentSegments: false,
      }),
    ).toBe(true);
    expect(
      isSafeForwardSlashPath("src/../secret.ts", {
        maxLength: 256,
        allowLeadingSlash: true,
        rejectCurrentSegments: false,
      }),
    ).toBe(false);
    expect(
      isSafeForwardSlashPath("src/./file.ts", {
        maxLength: 4_096,
        allowLeadingSlash: false,
        rejectCurrentSegments: true,
      }),
    ).toBe(false);
  });

  it("normalizes validated workspace file paths deterministically", () => {
    expect(parseWorkspaceFilePaths(["src/z.ts", "README.md", "src/z.ts"], TypeError)).toEqual([
      "README.md",
      "src/z.ts",
    ]);
    expect(() => parseWorkspaceFilePaths(["../outside.ts"], TypeError)).toThrow(TypeError);
  });

  it("makes the existing additional-property policy explicit for bounded bytes", () => {
    const value = { bytes: encoder.encode("text"), truncated: false, metadata: "preserved" };

    expect(parseBoundedBytes(value, TypeError, { allowAdditionalProperties: true })).toEqual({
      bytes: value.bytes,
      truncated: false,
    });
    expect(() => parseBoundedBytes(value, TypeError, { allowAdditionalProperties: false })).toThrow(
      TypeError,
    );
  });

  it("decodes a bounded UTF-8 prefix and removes only an incomplete suffix", () => {
    const source = encoder.encode("a界");

    expect(decodeBoundedUtf8Prefix({ bytes: source, truncated: true }, 3)).toEqual({
      text: "a",
      truncated: true,
    });
    expect(
      decodeBoundedUtf8Prefix({ bytes: new Uint8Array([0xff]), truncated: false }, 1),
    ).toBeUndefined();
  });
});
