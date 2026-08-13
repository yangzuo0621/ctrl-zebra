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
