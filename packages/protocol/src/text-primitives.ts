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

/**
 * Walks UTF-16 code units, decoding surrogate pairs into full code points and invoking
 * `onCodePoint` for each one. A lone/unpaired surrogate is substituted with U+FFFD when
 * `substituteInvalid` is set; otherwise iteration stops immediately and this returns `false`,
 * signaling malformed text. Persisted-identity encoding, reasoning-text measurement, and this
 * module's own host-independent UTF-8 encoder all decode UTF-16 the same way; only what happens
 * with each resulting code point differs.
 */
export function decodeUtf16CodePoints(
  value: string,
  onCodePoint: (codePoint: number) => void,
  substituteInvalid = false,
): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const firstCodeUnit = value.charCodeAt(index);
    let codePoint = firstCodeUnit;

    if (firstCodeUnit >= 0xd800 && firstCodeUnit <= 0xdbff) {
      const secondCodeUnit = value.charCodeAt(index + 1);
      if (secondCodeUnit >= 0xdc00 && secondCodeUnit <= 0xdfff) {
        codePoint = 0x10000 + ((firstCodeUnit - 0xd800) << 10) + (secondCodeUnit - 0xdc00);
        index += 1;
      } else if (substituteInvalid) {
        codePoint = 0xfffd;
      } else {
        return false;
      }
    } else if (firstCodeUnit >= 0xdc00 && firstCodeUnit <= 0xdfff) {
      if (substituteInvalid) {
        codePoint = 0xfffd;
      } else {
        return false;
      }
    }

    onCodePoint(codePoint);
  }

  return true;
}

/** Encodes text without making the protocol package depend on a host runtime. */
export function utf8Encode(value: string): Uint8Array {
  const bytes = new Uint8Array(utf8ByteLength(value));
  let offset = 0;

  decodeUtf16CodePoints(
    value,
    (codePoint) => {
      if (codePoint <= 0x7f) {
        bytes[offset] = codePoint;
        offset += 1;
      } else if (codePoint <= 0x7ff) {
        bytes[offset] = 0xc0 | (codePoint >> 6);
        bytes[offset + 1] = 0x80 | (codePoint & 0x3f);
        offset += 2;
      } else if (codePoint <= 0xffff) {
        bytes[offset] = 0xe0 | (codePoint >> 12);
        bytes[offset + 1] = 0x80 | ((codePoint >> 6) & 0x3f);
        bytes[offset + 2] = 0x80 | (codePoint & 0x3f);
        offset += 3;
      } else {
        bytes[offset] = 0xf0 | (codePoint >> 18);
        bytes[offset + 1] = 0x80 | ((codePoint >> 12) & 0x3f);
        bytes[offset + 2] = 0x80 | ((codePoint >> 6) & 0x3f);
        bytes[offset + 3] = 0x80 | (codePoint & 0x3f);
        offset += 4;
      }
    },
    true,
  );

  return bytes;
}
