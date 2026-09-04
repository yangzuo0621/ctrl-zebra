import { z } from "zod";

export function utf8ByteLength(value: string): number {
  let bytes = 0;

  for (const character of value) {
    bytes += utf8BytesForCodePoint(character.codePointAt(0) ?? 0);
  }

  return bytes;
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
