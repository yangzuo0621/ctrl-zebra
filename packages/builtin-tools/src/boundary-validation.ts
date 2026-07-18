export interface BoundedBytes {
  readonly bytes: Uint8Array;
  readonly truncated: boolean;
}

interface ForwardSlashPathOptions {
  readonly maxLength: number;
  readonly allowLeadingSlash: boolean;
  readonly rejectCurrentSegments: boolean;
}

interface ReadBytesOptions {
  readonly allowAdditionalProperties: boolean;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function hasOnlyKeys(
  value: Readonly<Record<string, unknown>>,
  allowedKeys: ReadonlySet<string>,
): boolean {
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

export function isSafeForwardSlashPath(
  value: unknown,
  { maxLength, allowLeadingSlash, rejectCurrentSegments }: ForwardSlashPathOptions,
): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength ||
    (!allowLeadingSlash && value.startsWith("/")) ||
    value.includes("\\")
  ) {
    return false;
  }

  const unsafeSegment = rejectCurrentSegments
    ? /(?:^|\/)\.{1,2}(?:\/|$)/u
    : /(?:^|\/)\.\.(?:\/|$)/u;
  return !unsafeSegment.test(value);
}

export function parseWorkspaceFilePaths(
  value: unknown,
  createError: () => Error,
): readonly string[] {
  if (!Array.isArray(value)) {
    throw createError();
  }

  const paths = value.map((path) => {
    if (
      !isSafeForwardSlashPath(path, {
        maxLength: 4_096,
        allowLeadingSlash: false,
        rejectCurrentSegments: true,
      })
    ) {
      throw createError();
    }

    return path;
  });

  return [...new Set(paths)].sort((left, right) => left.localeCompare(right, "en-US"));
}

export function parseBoundedBytes(
  value: unknown,
  createError: () => Error,
  { allowAdditionalProperties }: ReadBytesOptions,
): BoundedBytes {
  if (
    !isRecord(value) ||
    !(value.bytes instanceof Uint8Array) ||
    typeof value.truncated !== "boolean" ||
    (!allowAdditionalProperties && !hasOnlyKeys(value, new Set(["bytes", "truncated"])))
  ) {
    throw createError();
  }

  return { bytes: value.bytes, truncated: value.truncated };
}

export function decodeBoundedUtf8Prefix(
  source: BoundedBytes,
  maxBytes: number,
): { readonly text: string; readonly truncated: boolean } | undefined {
  const exceedsLimit = source.bytes.byteLength > maxBytes;
  const candidate = source.bytes.subarray(0, maxBytes);
  if (candidate.includes(0)) {
    return undefined;
  }

  const truncated = source.truncated || exceedsLimit;
  const maxTrim = truncated ? Math.min(3, candidate.byteLength) : 0;
  for (let trim = 0; trim <= maxTrim; trim += 1) {
    try {
      return {
        text: new TextDecoder("utf-8", { fatal: true }).decode(
          candidate.subarray(0, candidate.byteLength - trim),
        ),
        truncated: truncated || trim > 0,
      };
    } catch {
      // Only an incomplete UTF-8 suffix may be removed from an already truncated prefix.
    }
  }

  return undefined;
}
