import { z } from "zod";

const encoder = new TextEncoder();

/**
 * Uses the native encoder rather than summing `utf8BytesForCodePoint` per character: on large
 * inputs (e.g. a bounded file's full content, or a serialized MCP catalog/diagnostics envelope
 * checked against a byte ceiling) this measurably outperforms a JS-level loop, with identical
 * output -- including for a lone/unpaired surrogate, which `TextEncoder` substitutes with the
 * same 3-byte-wide U+FFFD replacement that `utf8BytesForCodePoint` already reports for the raw
 * surrogate code point.
 */
export function utf8ByteLength(value: string): number {
  return encoder.encode(value).byteLength;
}

export function utf8BytesForCodePoint(codePoint: number): number {
  if (codePoint <= 0x7f) {
    return 1;
  }
  if (codePoint <= 0x7ff) {
    return 2;
  }
  if (codePoint <= 0xffff) {
    return 3;
  }
  return 4;
}

/**
 * A Zod string schema bounded by both Unicode code points and UTF-8 bytes. Both the IDE and
 * workspace-file-reference contracts require this exact pair of bounds, so it is owned here
 * rather than defined once per consuming schema module.
 */
export function boundedTextSchema(maxCodePoints: number, maxBytes: number) {
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
